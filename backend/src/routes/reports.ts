import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { getSessionUser } from '../auth.ts';
import { listReports } from '../reports/registry.ts';

const ReportMetaSchema = z
  .object({
    id: z.string().openapi({ example: 'body-composition-dynamics' }),
    name: z.string().openapi({ example: 'Body composition dynamics' }),
    description: z.string(),
    supportedFormats: z.array(z.enum(['xlsx'])),
    paramsSchema: z.any().openapi({
      type: 'object',
      description: 'JSON Schema (draft 2020-12) of report parameters',
    }),
  })
  .openapi('ReportMeta');

const listReportsRoute = createRoute({
  method: 'get',
  path: '/api/reports',
  operationId: 'listReports',
  tags: ['reports'],
  summary: 'List available reports',
  responses: {
    200: {
      description: 'Registered report definitions',
      content: {
        'application/json': {
          schema: z.array(ReportMetaSchema),
        },
      },
    },
    401: {
      description: 'Not authenticated',
      content: {
        'application/json': {
          schema: z.object({ error: z.string() }),
        },
      },
    },
  },
});

export function registerReportsRoutes(app: OpenAPIHono): void {
  app.openapi(listReportsRoute, async (c) => {
    const user = await getSessionUser(c.req.raw.headers);
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    const meta = listReports().map((def) => ({
      id: def.id,
      name: def.name,
      description: def.description,
      supportedFormats: def.supportedFormats,
      paramsSchema: z.toJSONSchema(def.paramsSchema),
    }));
    return c.json(meta, 200);
  });
}
