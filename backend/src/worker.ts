import { Worker } from 'bullmq';

import { closeDb, sql } from './db/client.ts';
import { createRedisConnection } from './queue/index.ts';
import { REPORT_QUEUE, type GenerateReportJob } from './queue/jobs.ts';
import { runReport } from './reports/runner.ts';
import { publishRunUpdate } from './sse/publisher.ts';
import { ensureBucket, putReport } from './storage/minio.ts';

await ensureBucket();

const connection = createRedisConnection();

const worker = new Worker<GenerateReportJob>(
  REPORT_QUEUE,
  async (job) => {
    const { runId, reportId, format, params, userId } = job.data;
    console.log(`[worker] run ${runId} start (${reportId}/${format})`);

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
    console.log(`[worker] run ${runId} completed → ${key}`);
  },
  { connection, concurrency: 4 },
);

worker.on('ready', () => {
  console.log(`[worker] listening on queue "${REPORT_QUEUE}"`);
});

worker.on('failed', async (job, err) => {
  if (!job) return;
  console.error(`[worker] run ${job.data.runId} failed:`, err);
  const message = err.message ?? String(err);
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
    console.error('[worker] failed to persist failure state:', dbErr);
  }
});

const shutdown = async (signal: string) => {
  console.log(`[worker] ${signal} received, draining`);
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
