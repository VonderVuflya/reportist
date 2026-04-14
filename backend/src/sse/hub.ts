import IORedis, { type Redis } from 'ioredis';

import { config } from '../config.ts';

type Listener = (payload: string) => void;

const listeners = new Map<string, Set<Listener>>();
let subscriber: Redis | null = null;

function getSubscriber(): Redis {
  if (subscriber) return subscriber;
  subscriber = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
  subscriber.on('message', (channel, payload) => {
    const set = listeners.get(channel);
    if (!set) return;
    for (const listener of set) listener(payload);
  });
  return subscriber;
}

export function channelForRun(runId: string): string {
  return `run:${runId}`;
}

export async function subscribeToRun(
  runId: string,
  listener: Listener,
): Promise<() => Promise<void>> {
  const channel = channelForRun(runId);
  let set = listeners.get(channel);
  if (!set) {
    set = new Set();
    listeners.set(channel, set);
    await getSubscriber().subscribe(channel);
  }
  set.add(listener);

  return async () => {
    const current = listeners.get(channel);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      listeners.delete(channel);
      if (subscriber) await subscriber.unsubscribe(channel);
    }
  };
}
