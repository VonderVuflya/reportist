import type { MiddlewareHandler } from 'hono';

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
const SWEEP_EVERY_MS = 5 * 60_000;

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

function sweep(now: number) {
  if (now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function sessionKey(cookie: string | undefined): string | null {
  if (!cookie) return null;
  const match = cookie.match(/better-auth\.session_token=([^;]+)/);
  return match?.[1] ?? null;
}

/**
 * POST /api/runs rate limiter: fixed-window counter per better-auth session
 * token. In-memory — correct for single-process deploy. Scaling out swaps
 * the Map for redis INCR+EXPIRE behind the same contract.
 *
 * Skips non-POST and anonymous requests (handler returns 401 anyway; we
 * don't want unauthenticated callers to consume buckets keyed by a missing
 * cookie).
 */
export function rateLimitRuns(): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method !== 'POST') return next();
    const key = sessionKey(c.req.header('cookie'));
    if (!key) return next();

    const now = Date.now();
    sweep(now);

    const existing = buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
      return next();
    }

    existing.count++;
    if (existing.count > MAX_PER_WINDOW) {
      const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      c.header('Retry-After', String(retryAfter));
      c.header('X-RateLimit-Limit', String(MAX_PER_WINDOW));
      c.header('X-RateLimit-Remaining', '0');
      return c.json({ error: 'rate limit exceeded' }, 429);
    }

    c.header('X-RateLimit-Limit', String(MAX_PER_WINDOW));
    c.header(
      'X-RateLimit-Remaining',
      String(MAX_PER_WINDOW - existing.count),
    );
    return next();
  };
}
