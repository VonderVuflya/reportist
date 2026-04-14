import { createAuthClient } from 'better-auth/react';
import { baseUrl } from '../api/fetcher';

export const authClient = createAuthClient({
  baseURL: baseUrl,
});

export const { signUp, signIn, signOut, useSession } = authClient;
