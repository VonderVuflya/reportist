import IORedis, { type Redis } from 'ioredis';

import { config } from '../config.ts';
import { channelForRun } from './hub.ts';

let publisher: Redis | null = null;

function getPublisher(): Redis {
  if (publisher) return publisher;
  publisher = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
  return publisher;
}

export type RunUpdate = {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  resultKey?: string | null;
  errorMessage?: string | null;
};

export async function publishRunUpdate(update: RunUpdate): Promise<void> {
  await getPublisher().publish(channelForRun(update.id), JSON.stringify(update));
}
