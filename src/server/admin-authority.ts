import type { AdminActor } from './admin-context.ts';

// Recheck the authorizing session in the write transaction, including when a
// password verification or another asynchronous operation raced a revocation.
export const adminAuthority = `EXISTS (SELECT 1 FROM user a JOIN session s ON s.user_id=a.id
  WHERE a.id=? AND a.account_state='active' AND a.role='admin' AND a.credential_version=?
  AND s.id=? AND s.credential_version=a.credential_version AND s.expires_at>?)`;
export const authorityValues = (actor: AdminActor, now: number) =>
  [actor.id, actor.credentialVersion, actor.sessionId, now] as const;
