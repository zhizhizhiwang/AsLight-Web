import { Hono } from 'hono';
import { hashPassword } from 'better-auth/crypto';
import { activateInput, resetInput } from '../shared/access.ts';
import { assertAuthConfig } from './auth.ts';
import { consumeLimit, hashToken } from './security.ts';
import type { Bindings } from './bindings.ts';

export class AccessError extends Error {
  code: string;
  status: 400 | 401 | 403 | 404 | 409 | 410 | 429;
  constructor(code: string, message: string, status: 400 | 401 | 403 | 404 | 409 | 410 | 429) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
export function aliasConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    /UNIQUE constraint failed: user.login_alias/.test(error.message) || aliasConflict(error.cause)
  );
}

async function redeem(
  env: Bindings,
  input: { code: string; password: string; alias?: string; name?: string },
  purpose: 'activate' | 'reset',
) {
  const tokenHash = await hashToken(input.code);
  const checkedAt = Date.now();
  const claim = await env.DB.prepare(
    `SELECT c.user_id FROM account_claim c JOIN user u ON u.id=c.user_id
    WHERE c.token_hash=? AND c.purpose=? AND c.used_at IS NULL AND c.revoked_at IS NULL AND c.expires_at>?
      AND u.account_state=?`,
  )
    .bind(tokenHash, purpose, checkedAt, purpose === 'activate' ? 'pending' : 'active')
    .first<{ user_id: string }>();
  const invalid = () =>
    new AccessError('INVALID_CLAIM', '凭证无效、已使用或已过期，请联系管理员重新提供。', 410);
  if (!claim) throw invalid();
  const password = await hashPassword(input.password);
  const now = Date.now();
  const redemption = crypto.randomUUID();
  // Each following statement is guarded by the winner's unpredictable redemption
  // ID. D1 batch rolls all changes back if alias uniqueness or another write fails.
  const guard = 'EXISTS (SELECT 1 FROM account_claim WHERE token_hash=? AND redemption_id=?)';
  const userUpdate =
    purpose === 'activate'
      ? env.DB.prepare(
          `UPDATE user SET login_alias=?, name=?, account_state='active', credential_version=credential_version+1, updated_at=? WHERE id=? AND ${guard}`,
        ).bind(input.alias, input.name, now, claim.user_id, tokenHash, redemption)
      : env.DB.prepare(
          `UPDATE user SET credential_version=credential_version+1, updated_at=? WHERE id=? AND ${guard}`,
        ).bind(now, claim.user_id, tokenHash, redemption);
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE account_claim SET used_at=?, redemption_id=? WHERE token_hash=? AND purpose=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at>?`,
    ).bind(now, redemption, tokenHash, purpose, now),
    userUpdate,
    env.DB.prepare(
      `INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
      SELECT ?, ?, 'credential', ?, ?, ?, ? WHERE ${guard}
      ON CONFLICT(provider_id, account_id) DO UPDATE SET password=excluded.password, updated_at=excluded.updated_at`,
    ).bind(
      crypto.randomUUID(),
      claim.user_id,
      claim.user_id,
      password,
      now,
      now,
      tokenHash,
      redemption,
    ),
    env.DB.prepare(`DELETE FROM session WHERE user_id=? AND ${guard}`).bind(
      claim.user_id,
      tokenHash,
      redemption,
    ),
    env.DB.prepare(
      `UPDATE account_claim SET revoked_at=? WHERE user_id=? AND token_hash<>? AND used_at IS NULL AND revoked_at IS NULL AND ${guard}`,
    ).bind(now, claim.user_id, tokenHash, tokenHash, redemption),
    env.DB.prepare(
      `INSERT INTO audit_event (id, actor_id, target_id, action, reason, created_at)
      SELECT ?, ?, ?, ?, ?, ? WHERE ${guard}`,
    ).bind(
      crypto.randomUUID(),
      claim.user_id,
      claim.user_id,
      purpose === 'activate' ? 'account_activated' : 'password_reset',
      '成员凭专属凭证完成操作',
      now,
      tokenHash,
      redemption,
    ),
  ]);
  if (results[0]?.meta.changes !== 1) throw invalid();
}

export const access = new Hono<{ Bindings: Bindings }>()
  .use('*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store');
    assertAuthConfig(c.env, c.req.raw);
    if (c.req.header('Origin') !== c.env.APP_ORIGIN)
      throw new AccessError('INVALID_ORIGIN', '请求来源不受信任。', 403);
    const limit = await consumeLimit(
      c.env,
      `claim:${c.req.path}:${c.req.header('cf-connecting-ip') ?? 'local'}`,
      { window: 60, max: 10 },
    );
    if (!limit.allowed) {
      c.header('Retry-After', String(limit.retryAfter));
      throw new AccessError('TOO_MANY_REQUESTS', '操作过于频繁，请稍后重试。', 429);
    }
    await next();
  })
  .post('/activate', async (c) => {
    const result = activateInput.safeParse(await c.req.json().catch(() => null));
    if (!result.success)
      throw new AccessError('INVALID_INPUT', '请检查激活码、11 位登录别称、昵称和密码。', 400);
    try {
      await redeem(c.env, result.data, 'activate');
    } catch (error) {
      if (aliasConflict(error))
        throw new AccessError('ALIAS_TAKEN', '该登录别称已被使用，请修改或联系管理员。', 409);
      throw error;
    }
    return c.json({ success: true });
  })
  .post('/reset-password', async (c) => {
    const result = resetInput.safeParse(await c.req.json().catch(() => null));
    if (!result.success) throw new AccessError('INVALID_INPUT', '请检查重设凭证和新密码。', 400);
    await redeem(c.env, result.data, 'reset');
    return c.json({ success: true });
  });
