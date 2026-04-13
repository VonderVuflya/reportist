import { OpenAPIHono } from '@hono/zod-openapi';
import { registerRoutes } from '../src/app.ts';

const app = registerRoutes(new OpenAPIHono());

const spec = app.getOpenAPI31Document({
  openapi: '3.1.0',
  info: { title: 'Reportist API', version: '0.1.0' },
});

const outPath = new URL('../openapi.json', import.meta.url);
await Bun.write(outPath, JSON.stringify(spec, null, 2) + '\n');
console.log(`wrote ${outPath.pathname}`);
