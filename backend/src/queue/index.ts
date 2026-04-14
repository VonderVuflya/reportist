import { Queue } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';

import { config } from '../config.ts';
import { REPORT_QUEUE, type GenerateReportJob } from './jobs.ts';

export function createRedisConnection(): Redis {
  return new IORedis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
  });
}

let queueSingleton: Queue<GenerateReportJob> | null = null;

export function getReportQueue(): Queue<GenerateReportJob> {
  if (!queueSingleton) {
    queueSingleton = new Queue<GenerateReportJob>(REPORT_QUEUE, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 100 },
      },
    });
  }
  return queueSingleton;
}

export async function closeReportQueue(): Promise<void> {
  if (queueSingleton) {
    await queueSingleton.close();
    queueSingleton = null;
  }
}
