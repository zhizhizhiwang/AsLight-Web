import { Hono } from 'hono';
import { verifyPassword } from 'better-auth/crypto';
import { roleChangeInput } from '../shared/access.ts';
import { AccessError } from './access.ts';
import { consumeLimit } from './security.ts';
import { adminAuthority, authorityValues } from './admin-authority.ts';
import type { AdminContext } from './admin-context.ts';

export const adminRoles = new Hono<AdminContext>().post('/:id/role', async (c) => {
  const parsed = roleChangeInput.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new AccessError('INVALID_INPUT', '请填写当前密码和操作原因。', 400);
  const actor = c.get('actor'),
    target = c.req.param('id'),
    input = parsed.data;
  if (actor.id === target)
    throw new AccessError('ROLE_SELF_CHANGE', '不能修改自己的管理员权限。', 403);
  const limit = await consumeLimit(c.env, `role-password:${actor.id}`, { window: 300, max: 5 });
  if (!limit.allowed) {
    c.header('Retry-After', String(limit.retryAfter));
    throw new AccessError('TOO_MANY_REQUESTS', '密码确认过于频繁，请稍后重试。', 429);
  }
  const credential = await c.env.DB.prepare(
    "SELECT password FROM account WHERE user_id=? AND account_id=? AND provider_id='credential'",
  )
    .bind(actor.id, actor.id)
    .first<{ password: string | null }>();
  if (
    !credential?.password ||
    !(await verifyPassword({ hash: credential.password, password: input.password }))
  )
    throw new AccessError('REAUTH_FAILED', '当前密码不正确，请重新输入。', 403);
  const operation = crypto.randomUUID(),
    now = Date.now();
  const action = input.role === 'admin' ? 'admin_granted' : 'admin_revoked';
  const guard = 'EXISTS (SELECT 1 FROM audit_event WHERE id=?)';
  const result = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO audit_event(id,actor_id,target_id,action,reason,created_at)
      SELECT ?,?,u.id,?,?,? FROM user u WHERE u.id=? AND u.id<>? AND u.account_state='active'
      AND u.role<>? AND u.role_version=? AND ${adminAuthority}
      AND EXISTS(SELECT 1 FROM account WHERE user_id=? AND account_id=? AND provider_id='credential' AND password=?)
      AND (?='admin' OR (SELECT COUNT(*) FROM user WHERE role='admin' AND account_state='active')>1)`,
    ).bind(
      operation,
      actor.id,
      action,
      input.reason,
      now,
      target,
      actor.id,
      input.role,
      input.expectedVersion,
      ...authorityValues(actor, now),
      actor.id,
      actor.id,
      credential.password,
      input.role,
    ),
    c.env.DB.prepare(
      `UPDATE user SET role=?,role_version=role_version+1,credential_version=credential_version+1,updated_at=? WHERE id=? AND ${guard}`,
    ).bind(input.role, now, target, operation),
    c.env.DB.prepare(`DELETE FROM session WHERE user_id=? AND ${guard}`).bind(target, operation),
    c.env.DB.prepare(
      `UPDATE account_claim SET revoked_at=? WHERE user_id=? AND used_at IS NULL AND revoked_at IS NULL AND ${guard}`,
    ).bind(now, target, operation),
  ]);
  if (result[0]?.meta.changes !== 1)
    throw new AccessError(
      'ROLE_STATE_CHANGED',
      '账号或权限已变化，请重新加载；至少需要保留一位已激活管理员。',
      409,
    );
  return c.json({ success: true });
});
