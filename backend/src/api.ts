import { OpenAPIHono } from '@hono/zod-openapi';
import { QueueEvents } from 'bullmq';
import { cors } from 'hono/cors';
import IORedis from 'ioredis';

import { auth } from './auth.ts';
import { config } from './config.ts';
import { sql } from './db/client.ts';
import { logger } from './logger.ts';
import {
  register as metricsRegister,
  runDurationHistogram,
  runsFinishedCounter,
} from './metrics.ts';
import { rateLimitRuns } from './middleware/rate-limit.ts';
import { createRedisConnection, getReportQueue } from './queue/index.ts';
import { REPORT_QUEUE } from './queue/jobs.ts';
import { registerRoutes } from './app.ts';

const log = logger.child({ svc: 'api' });

const app = new OpenAPIHono();

app.use(
  '*',
  cors({
    origin: config.WEB_ORIGIN,
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  }),
);

app.use('/api/runs', rateLimitRuns());

app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

app.get('/api/me', async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: 'unauthorized' }, 401);
  return c.json({ user: session.user });
});

const healthRedis = new IORedis(config.REDIS_URL, {
  maxRetriesPerRequest: 1,
  connectTimeout: 1500,
});

app.get('/healthz', async (c) => {
  const checks: Record<string, 'ok' | 'fail'> = { db: 'ok', redis: 'ok' };
  try {
    await sql`SELECT 1`;
  } catch (err) {
    checks.db = 'fail';
    log.warn({ err }, 'healthz: db check failed');
  }
  try {
    const pong = await healthRedis.ping();
    if (pong !== 'PONG') checks.redis = 'fail';
  } catch (err) {
    checks.redis = 'fail';
    log.warn({ err }, 'healthz: redis check failed');
  }
  const ok = Object.values(checks).every((v) => v === 'ok');
  return c.json({ status: ok ? 'ok' : 'degraded', checks }, ok ? 200 : 503);
});

app.get('/metrics', async (c) => {
  const body = await metricsRegister.metrics();
  return c.text(body, 200, { 'Content-Type': metricsRegister.contentType });
});

registerRoutes(app);

const queueEvents = new QueueEvents(REPORT_QUEUE, {
  connection: createRedisConnection(),
});

queueEvents.on('completed', async ({ jobId }) => {
  try {
    const job = await getReportQueue().getJob(jobId);
    if (!job) return;
    const labels = {
      report_id: job.data.reportId,
      format: job.data.format,
    };
    runsFinishedCounter.inc({ ...labels, status: 'completed' });
    if (job.processedOn && job.finishedOn) {
      runDurationHistogram.observe(
        labels,
        (job.finishedOn - job.processedOn) / 1000,
      );
    }
  } catch (err) {
    log.error({ err }, 'queue events: completed handler failed');
  }
});

queueEvents.on('failed', async ({ jobId }) => {
  try {
    const job = await getReportQueue().getJob(jobId);
    if (!job) return;
    runsFinishedCounter.inc({
      report_id: job.data.reportId,
      format: job.data.format,
      status: 'failed',
    });
  } catch (err) {
    log.error({ err }, 'queue events: failed handler failed');
  }
});

log.info({ port: config.API_PORT }, 'api starting');

export default {
  port: config.API_PORT,
  fetch: app.fetch,
};
