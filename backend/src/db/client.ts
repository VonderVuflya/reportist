import postgres from 'postgres';
import { config } from '../config.ts';

export const sql = postgres(config.DATABASE_URL, {
  onnotice: () => {},
});

export const closeDb = () => sql.end({ timeout: 5 });
