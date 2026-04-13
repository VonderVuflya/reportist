import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.url(),
  AUTH_SECRET: z.string().min(32),
  AUTH_BASE_URL: z.url(),
  WEB_ORIGIN: z.url(),
  API_PORT: z.coerce.number().int().positive().default(3000),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  console.error(`[config] invalid environment:\n${issues}`);
  process.exit(1);
}

export const config = parsed.data;
