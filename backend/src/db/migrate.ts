import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from 'pg';
import { config } from '../config.ts';

const MIGRATIONS_DIR = join(import.meta.dir, '..', '..', 'migrations');

async function listMigrationFiles(): Promise<string[]> {
  try {
    const entries = await readdir(MIGRATIONS_DIR);
    return entries.filter((f) => f.endsWith('.sql')).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

export async function migrate(): Promise<void> {
  const client = new Client({ connectionString: config.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query<{ name: string }>(
      'SELECT name FROM _migrations',
    );
    const applied = new Set(rows.map((r) => r.name));

    const files = await listMigrationFiles();
    const pending = files.filter((f) => !applied.has(f));

    if (pending.length === 0) {
      console.log('[migrate] no pending migrations');
      return;
    }

    for (const name of pending) {
      console.log(`[migrate] applying ${name}`);
      const sql = await Bun.file(join(MIGRATIONS_DIR, name)).text();
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [name]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
    console.log(`[migrate] applied ${pending.length} migration(s)`);
  } finally {
    await client.end();
  }
}

if (import.meta.main) {
  migrate().catch((err) => {
    console.error('[migrate] failed:', err);
    process.exit(1);
  });
}
