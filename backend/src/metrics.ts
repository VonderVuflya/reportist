import client from 'prom-client';

export const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'reportist_' });

export const runsEnqueuedCounter = new client.Counter({
  name: 'reportist_runs_enqueued_total',
  help: 'Report runs enqueued',
  labelNames: ['report_id', 'format'] as const,
  registers: [register],
});

export const runsFinishedCounter = new client.Counter({
  name: 'reportist_runs_finished_total',
  help: 'Report runs finished by status',
  labelNames: ['report_id', 'format', 'status'] as const,
  registers: [register],
});

export const runDurationHistogram = new client.Histogram({
  name: 'reportist_run_duration_seconds',
  help: 'Run execution time in seconds (worker-side)',
  labelNames: ['report_id', 'format'] as const,
  buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60],
  registers: [register],
});
