process.env.DATABASE_URL ??=
  'postgres://placeholder:placeholder@localhost:5432/placeholder'
process.env.AUTH_SECRET ??= 'x'.repeat(32)
process.env.AUTH_BASE_URL ??= 'http://localhost:3000'
process.env.WEB_ORIGIN ??= 'http://localhost:5173'
process.env.REDIS_URL ??= 'redis://localhost:6379'
process.env.MINIO_ENDPOINT ??= 'localhost'
process.env.MINIO_ACCESS_KEY ??= 'placeholder'
process.env.MINIO_SECRET_KEY ??= 'placeholder'

const { OpenAPIHono } = await import('@hono/zod-openapi')
const { registerRoutes } = await import('../src/app.ts')

const app = registerRoutes(new OpenAPIHono())

const spec = app.getOpenAPI31Document({
  openapi: '3.1.0',
  info: { title: 'Reportist API', version: '0.1.0' },
})

const outPath = new URL('../openapi.json', import.meta.url)
await Bun.write(outPath, JSON.stringify(spec, null, 2) + '\n')
console.log(`wrote ${outPath.pathname}`)
