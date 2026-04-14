import type { OpenAPIHono } from '@hono/zod-openapi';
import { Scalar } from '@scalar/hono-api-reference';
import { registerClientsRoutes } from './routes/clients.ts';
import { registerReportsRoutes } from './routes/reports.ts';
import { registerRunsRoutes } from './routes/runs.ts';

export function registerRoutes<T extends OpenAPIHono>(app: T): T {
  registerReportsRoutes(app);
  registerClientsRoutes(app);
  registerRunsRoutes(app);

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
