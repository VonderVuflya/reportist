import { Worker } from 'bullmq';

import { closeDb, sql } from './db/client.ts';
import { logger } from './logger.ts';
import { createRedisConnection } from './queue/index.ts';
import { REPORT_QUEUE, type GenerateReportJob } from './queue/jobs.ts';
import { runReport } from './reports/runner.ts';
import { publishRunUpdate } from './sse/publisher.ts';
import { putReport } from './storage/minio.ts';

const log = logger.child({ svc: 'worker' });

const connection = createRedisConnection();

const worker = new Worker<GenerateReportJob>(
  REPORT_QUEUE,
  async (job) => {
    const { runId, reportId, format, params, userId } = job.data;
    log.info({ runId, reportId, format }, 'run start');

    await sql`UPDATE runs SET status = 'running' WHERE id = ${runId}`;
    await publishRunUpdate({ id: runId, status: 'running' });

    const artifact = await runReport(reportId, format, params, {
      db: sql,
      userId,
    });

    const key = `reports/${userId}/${runId}.${format}`;
    await putReport(key, artifact.buffer, artifact.contentType);

    await sql`
      UPDATE runs
      SET status = 'completed', result_key = ${key}
      WHERE id = ${runId}
    `;
    await publishRunUpdate({ id: runId, status: 'completed', resultKey: key });
    log.info({ runId, key }, 'run completed');
  },
  { connection, concurrency: 4 },
);

worker.on('ready', () => {
  log.info({ queue: REPORT_QUEUE }, 'listening on queue');
});

worker.on('failed', async (job, err) => {
  if (!job) return;
  const message = err.message ?? String(err);
  log.error({ err, runId: job.data.runId }, 'run failed');
  try {
    await sql`
      UPDATE runs
      SET status = 'failed', error_message = ${message}
      WHERE id = ${job.data.runId}
    `;
    await publishRunUpdate({
      id: job.data.runId,
      status: 'failed',
      errorMessage: message,
    });
  } catch (dbErr) {
    log.error({ err: dbErr, runId: job.data.runId }, 'failed to persist failure state');
  }
});

const shutdown = async (signal: string) => {
  log.info({ signal }, 'shutdown received, draining');
  try {
    await worker.close();
    await connection.quit();
    await closeDb();
  } finally {
    process.exit(0);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
