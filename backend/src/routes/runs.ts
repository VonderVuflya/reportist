import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { getSessionUser } from '../auth.ts'
import { sql } from '../db/client.ts'
import { getReportQueue } from '../queue/index.ts'
import { getReport } from '../reports/registry.ts'
import { REPORT_FORMATS, type ReportFormat } from '../reports/types.ts'
import { subscribeToRun } from '../sse/hub.ts'
import { getReportStream, statReport } from '../storage/minio.ts'

const RunSchema = z
  .object({
    id: z.uuid(),
    reportId: z.string(),
    format: z.enum(REPORT_FORMATS),
    status: z.enum(['queued', 'running', 'completed', 'failed']),
    params: z.record(z.string(), z.unknown()),
    createdAt: z.string(),
    resultKey: z.string().nullable(),
    errorMessage: z.string().nullable(),
  })
  .openapi('Run')

const CreateRunBodySchema = z
  .object({
    reportId: z.string(),
    format: z.enum(REPORT_FORMATS),
    params: z.record(z.string(), z.unknown()),
  })
  .openapi('CreateRunBody')

const CreateRunResponseSchema = z
  .object({
    id: z.string().uuid(),
    status: z.enum(['queued', 'running', 'completed', 'failed']),
  })
  .openapi('CreateRunResponse')

const ErrorSchema = z.object({ error: z.string() })

type RunRow = {
  id: string
  report_id: string
  format: ReportFormat
  status: 'queued' | 'running' | 'completed' | 'failed'
  params: Record<string, unknown>
  created_at: Date
  result_key: string | null
  error_message: string | null
}

function rowToRun(row: RunRow) {
  return {
    id: row.id,
    reportId: row.report_id,
    format: row.format,
    status: row.status,
    params: row.params,
    createdAt: row.created_at.toISOString(),
    resultKey: row.result_key,
    errorMessage: row.error_message,
  }
}

const createRunRoute = createRoute({
  method: 'post',
  path: '/api/runs',
  operationId: 'createRun',
  tags: ['runs'],
  summary: 'Enqueue a new report run',
  request: {
    body: {
      required: true,
      content: {
        'application/json': { schema: CreateRunBodySchema },
      },
    },
  },
  responses: {
    202: {
      description: 'Run has been queued',
      content: { 'application/json': { schema: CreateRunResponseSchema } },
    },
    400: {
      description: 'Invalid report id, format or params',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    401: {
      description: 'Not authenticated',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

const listRunsRoute = createRoute({
  method: 'get',
  path: '/api/runs',
  operationId: 'listRuns',
  tags: ['runs'],
  summary: "Current user's run history",
  responses: {
    200: {
      description: 'Runs ordered by creation time desc',
      content: { 'application/json': { schema: z.array(RunSchema) } },
    },
    401: {
      description: 'Not authenticated',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

const getRunRoute = createRoute({
  method: 'get',
  path: '/api/runs/{id}',
  operationId: 'getRun',
  tags: ['runs'],
  summary: 'Single run for polling',
  request: {
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: {
      description: 'Single run',
      content: { 'application/json': { schema: RunSchema } },
    },
    401: {
      description: 'Not authenticated',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    404: {
      description: 'Run not found',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
})

export function registerRunsRoutes(app: OpenAPIHono): void {
  app.openapi(createRunRoute, async c => {
    const user = await getSessionUser(c.req.raw.headers)
    if (!user) return c.json({ error: 'unauthorized' }, 401)

    const body = c.req.valid('json')
    const def = getReport(body.reportId)
    if (!def) return c.json({ error: `unknown report: ${body.reportId}` }, 400)
    if (!def.supportedFormats.includes(body.format)) {
      return c.json(
        { error: `format ${body.format} not supported by ${body.reportId}` },
        400
      )
    }
    const paramsCheck = def.paramsSchema.safeParse(body.params)
    if (!paramsCheck.success) {
      return c.json(
        {
          error: `invalid params: ${paramsCheck.error.issues[0]?.message ?? 'validation failed'}`,
        },
        400
      )
    }

    const [row] = await sql<{ id: string; status: 'queued' }[]>`
      INSERT INTO runs (user_id, report_id, format, params, status)
      VALUES (${user.id}, ${body.reportId}, ${body.format}, ${sql.json(body.params as Record<string, never>)}, 'queued')
      RETURNING id, status
    `
    if (!row) return c.json({ error: 'failed to create run' }, 400)

    await getReportQueue().add('generate', {
      runId: row.id,
      reportId: body.reportId,
      format: body.format,
      params: body.params,
      userId: user.id,
    })

    return c.json({ id: row.id, status: row.status }, 202)
  })

  app.openapi(listRunsRoute, async c => {
    const user = await getSessionUser(c.req.raw.headers)
    if (!user) return c.json({ error: 'unauthorized' }, 401)
    const rows = await sql<RunRow[]>`
      SELECT id, report_id, format, status, params, created_at, result_key, error_message
      FROM runs
      WHERE user_id = ${user.id}
      ORDER BY created_at DESC
      LIMIT 50
    `
    return c.json(rows.map(rowToRun), 200)
  })

  app.openapi(getRunRoute, async c => {
    const user = await getSessionUser(c.req.raw.headers)
    if (!user) return c.json({ error: 'unauthorized' }, 401)
    const { id } = c.req.valid('param')
    const rows = await sql<RunRow[]>`
      SELECT id, report_id, format, status, params, created_at, result_key, error_message
      FROM runs
      WHERE id = ${id} AND user_id = ${user.id}
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return c.json({ error: 'not found' }, 404)
    return c.json(rowToRun(row), 200)
  })

  app.get('/api/runs/:id/download', async c => {
    const user = await getSessionUser(c.req.raw.headers)
    if (!user) return c.json({ error: 'unauthorized' }, 401)

    const id = c.req.param('id')
    const rows = await sql<
      {
        status: RunRow['status']
        result_key: string | null
        format: RunRow['format']
        report_id: string
      }[]
    >`
      SELECT status, result_key, format, report_id
      FROM runs
      WHERE id = ${id} AND user_id = ${user.id}
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return c.json({ error: 'not found' }, 404)
    if (row.status !== 'completed' || !row.result_key) {
      return c.json({ error: `run is ${row.status}` }, 409)
    }

    const stat = await statReport(row.result_key)
    const stream = await getReportStream(row.result_key)
    const filename = `${row.report_id}-${id}.${row.format}`

    return new Response(stream as unknown as ReadableStream, {
      status: 200,
      headers: {
        'Content-Type': stat?.contentType ?? 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
        ...(stat?.size ? { 'Content-Length': String(stat.size) } : {}),
      },
    })
  })

  app.get('/api/runs/:id/sse', async c => {
    const user = await getSessionUser(c.req.raw.headers)
    if (!user) return c.json({ error: 'unauthorized' }, 401)

    const id = c.req.param('id')
    const rows = await sql<RunRow[]>`
      SELECT id, report_id, format, status, params, created_at, result_key, error_message
      FROM runs
      WHERE id = ${id} AND user_id = ${user.id}
      LIMIT 1
    `
    const row = rows[0]
    if (!row) return c.json({ error: 'not found' }, 404)

    const encoder = new TextEncoder()
    let unsubscribe: (() => Promise<void>) | null = null
    let keepalive: ReturnType<typeof setInterval> | null = null
    let closed = false

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: string, data: string) => {
          if (closed) return
          try {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${data}\n\n`)
            )
          } catch {
            closed = true
          }
        }

        send('run', JSON.stringify(rowToRun(row)))

        unsubscribe = await subscribeToRun(id, payload => {
          send('run', payload)
        })

        const rowsAfter = await sql<RunRow[]>`
          SELECT id, report_id, format, status, params, created_at, result_key, error_message
          FROM runs
          WHERE id = ${id} AND user_id = ${user.id}
          LIMIT 1
        `
        const rowAfter = rowsAfter[0]
        if (rowAfter && rowAfter.status !== row.status) {
          send('run', JSON.stringify(rowToRun(rowAfter)))
        }

        keepalive = setInterval(() => {
          if (closed) return
          try {
            controller.enqueue(encoder.encode(`: ping\n\n`))
          } catch {
            closed = true
          }
        }, 15000)
      },
      async cancel() {
        closed = true
        if (keepalive) {
          clearInterval(keepalive)
          keepalive = null
        }
        if (unsubscribe) {
          const u = unsubscribe
          unsubscribe = null
          await u()
        }
      },
    })

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  })
}
