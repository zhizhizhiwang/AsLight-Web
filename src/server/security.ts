import type { Bindings } from './bindings.ts';

export async function hashToken(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

export async function consumeLimit(
  env: Bindings,
  key: string,
  rule: { window: number; max: number },
) {
  const now = Math.floor(Date.now() / 1000);
  const result = await env.DB.batch<{ count: number; starts_at: number }>([
    env.DB.prepare('DELETE FROM throttle WHERE starts_at < ?').bind(now - 172800),
    env.DB.prepare(
      `INSERT INTO throttle (key, count, starts_at) VALUES (?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET
        count = CASE WHEN starts_at + ? <= ? THEN 1 ELSE MIN(count + 1, ?) END,
        starts_at = CASE WHEN starts_at + ? <= ? THEN ? ELSE starts_at END
      RETURNING count, starts_at`,
    ).bind(await hashToken(key), now, rule.window, now, rule.max + 1, rule.window, now, now),
  ]);
  const row = result[1]?.results[0];
  if (!row || typeof row.count !== 'number' || typeof row.starts_at !== 'number')
    throw new Error('Rate limit unavailable.');
  return {
    allowed: row.count <= rule.max,
    retryAfter: row.count > rule.max ? Math.max(1, row.starts_at + rule.window - now) : null,
  };
}
