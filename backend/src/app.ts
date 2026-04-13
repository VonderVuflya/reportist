import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Scalar } from '@scalar/hono-api-reference';

const ReportSchema = z
  .object({
    id: z.string().openapi({ example: 'body-composition-dynamics' }),
    name: z.string().openapi({ example: 'Body composition dynamics' }),
  })
  .openapi('Report');

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
          schema: z.array(ReportSchema),
        },
      },
    },
  },
});

export function registerRoutes<T extends OpenAPIHono>(app: T): T {
  app.openapi(listReportsRoute, (c) => c.json([], 200));

  app.doc('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'Reportist API',
      version: '0.1.0',
    },
  });

  app.get('/reference', Scalar({ url: '/openapi.json' }));

  return app;
}
