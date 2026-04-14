import type { OpenAPIHono } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { getSessionUser } from '../auth.ts';
import { sql } from '../db/client.ts';
import { runReport } from '../reports/runner.ts';
import { ReportError } from '../reports/types.ts';

const createRunBody = z.object({
  reportId: z.string(),
  format: z.enum(['xlsx']),
  params: z.unknown(),
});

export function registerRunsRoutes(app: OpenAPIHono): void {
  app.post('/api/runs', async (c) => {
    const user = await getSessionUser(c.req.raw.headers);
    if (!user) return c.json({ error: 'unauthorized' }, 401);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const parsed = createRunBody.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: 'validation_error', issues: parsed.error.issues },
        400,
      );
    }

    try {
      const artifact = await runReport(
        parsed.data.reportId,
        parsed.data.format,
        parsed.data.params,
        { db: sql, userId: user.id },
      );
      return new Response(artifact.buffer, {
        status: 200,
        headers: {
          'Content-Type': artifact.contentType,
          'Content-Disposition': `attachment; filename="${artifact.filename}"`,
          'Content-Length': String(artifact.buffer.byteLength),
        },
      });
    } catch (err) {
      if (err instanceof ReportError) {
        const status =
          err.code === 'not_found'
            ? 404
            : err.code === 'validation_error' || err.code === 'unprocessable'
              ? 422
              : 500;
        return c.json(
          { error: err.code, message: err.message, details: err.details },
          status,
        );
      }
      console.error('[runs] render failed', err);
      return c.json({ error: 'internal_error' }, 500);
    }
  });
}
