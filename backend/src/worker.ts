import { Worker } from 'bullmq';

import { closeDb, sql } from './db/client.ts';
import { createRedisConnection } from './queue/index.ts';
import { REPORT_QUEUE, type GenerateReportJob } from './queue/jobs.ts';
import { runReport } from './reports/runner.ts';
import { ensureBucket, putReport } from './storage/minio.ts';

await ensureBucket();

const connection = createRedisConnection();

const worker = new Worker<GenerateReportJob>(
  REPORT_QUEUE,
  async (job) => {
    const { runId, reportId, format, params, userId } = job.data;
    console.log(`[worker] run ${runId} start (${reportId}/${format})`);

    await sql`UPDATE runs SET status = 'running' WHERE id = ${runId}`;

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
  try {
    await sql`
      UPDATE runs
      SET status = 'failed', error_message = ${err.message ?? String(err)}
      WHERE id = ${job.data.runId}
    `;
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
