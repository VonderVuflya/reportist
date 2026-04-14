import { betterAuth } from 'better-auth';
import { Pool } from 'pg';
import { config } from './config.ts';

export const auth = betterAuth({
  database: new Pool({ connectionString: config.DATABASE_URL }),
  secret: config.AUTH_SECRET,
  baseURL: config.AUTH_BASE_URL,
  trustedOrigins: [config.WEB_ORIGIN],
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
  advanced: {
    defaultCookieAttributes: {
      sameSite: 'lax',
      secure: config.NODE_ENV === 'production',
    },
  },
});

export async function getSessionUser(
  headers: Headers,
): Promise<{ id: string; email: string; name: string } | null> {
  const session = await auth.api.getSession({ headers });
  return session?.user ?? null;
}
