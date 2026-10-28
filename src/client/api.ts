import { hc } from 'hono/client';
import type { AppType } from '../server/index.ts';

// This type-only import is erased. No server implementation belongs in the client bundle.
export const api = hc<AppType>('/');
