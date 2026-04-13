import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { auth } from './auth.ts';
import { config } from './config.ts';

const app = new Hono();

app.use(
  '*',
  cors({
    origin: config.WEB_ORIGIN,
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  }),
);

app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

app.get('/api/me', async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: 'unauthorized' }, 401);
  return c.json({ user: session.user });
});

export default {
  port: config.API_PORT,
  fetch: app.fetch,
};
