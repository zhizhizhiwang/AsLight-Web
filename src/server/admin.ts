import { Hono } from 'hono';
import { z } from 'zod';
import { assertAuthConfig, currentIdentity } from './auth.ts';
import { AccessError, aliasConflict } from './access.ts';
import { hashToken, randomToken, consumeLimit } from './security.ts';
import { loginAliasInput } from '../shared/access.ts';
import { learningAdmin } from './learning-admin.ts';
import { permissionInputSchema } from '../shared/editor.ts';
import { videoAdmin } from './videos.ts';
import { adminRoles } from './admin-roles.ts';
import type { AdminContext } from './admin-context.ts';
import { adminAuthority, authorityValues } from './admin-authority.ts';

const nameInput = z.strictObject({ name: z.string().trim().min(1).max(40) });
const reasonInput = z.strictObject({ reason: z.string().trim().min(1).max(200) });
const tokenLink = (origin: string, purpose: string, code: string) =>
  `${origin}/account?mode=${purpose}#code=${code}`;

export const admin = new Hono<AdminContext>()
  .use('*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store');
    assertAuthConfig(c.env, c.req.raw);
    if (c.req.method !== 'GET' && c.req.header('Origin') !== c.env.APP_ORIGIN)
      throw new AccessError('INVALID_ORIGIN', '请求来源不受信任。', 403);
    const identity = await currentIdentity(c.env, c.req.raw.headers);
    if (!identity) throw new AccessError('NOT_SIGNED_IN', '请先登录。', 401);
    const user = identity.user;
    if (user.role !== 'admin') throw new AccessError('FORBIDDEN', '仅管理员可以进行此操作。', 403);
    c.set('actor', {
      id: user.id,
      credentialVersion: user.credentialVersion,
      sessionId: identity.sessionId,
    });
    if (
      c.req.method !== 'GET' &&
      !(await consumeLimit(c.env, `admin:${user.id}`, { window: 60, max: 30 })).allowed
    )
      throw new AccessError('TOO_MANY_REQUESTS', '操作过于频繁，请稍后重试。', 429);
    await next();
  })
  .get('/members', async (c) => {
    const rows = await c.env.DB.prepare(
      'SELECT u.id, u.name, u.login_alias, u.account_state, u.role, u.role_version, u.created_at, COALESCE(p.can_edit,0) AS can_edit, COALESCE(p.version,0) AS permission_version FROM user u LEFT JOIN content_permission p ON p.user_id=u.id ORDER BY u.created_at DESC, u.id',
    ).all<{
      id: string;
      name: string;
      login_alias: string | null;
      account_state: string;
      role: string;
      role_version: number;
      created_at: number;
      can_edit: number;
      permission_version: number;
    }>();
    return c.json({
      members: rows.results.map((row) => ({
        id: row.id,
        name: row.name,
        alias: row.login_alias
          ? `${row.login_alias.slice(0, 3)}****${row.login_alias.slice(-4)}`
          : null,
        state: row.account_state,
        role: row.role,
        roleVersion: row.role_version,
        createdAt: row.created_at,
        canEdit: row.can_edit === 1,
        permissionVersion: row.permission_version,
      })),
    });
  })
  .post('/members/:id/content-permission', async (c) => {
    const parsed = permissionInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AccessError('INVALID_INPUT', '请填写操作原因。', 400);
    const target = c.req.param('id'),
      input = parsed.data,
      operation = crypto.randomUUID();
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO content_permission (user_id,can_edit,version,operation_id) SELECT id,?,1,? FROM user WHERE id=? AND account_state='active' AND ?=0
        ON CONFLICT(user_id) DO NOTHING`,
      ).bind(input.canEdit ? 1 : 0, operation, target, input.expectedVersion),
      c.env.DB.prepare(
        `UPDATE content_permission SET can_edit=?,version=version+1,operation_id=? WHERE user_id=? AND version=? AND ?>0 AND EXISTS (SELECT 1 FROM user WHERE id=? AND account_state='active')`,
      ).bind(
        input.canEdit ? 1 : 0,
        operation,
        target,
        input.expectedVersion,
        input.expectedVersion,
        target,
      ),
      c.env.DB.prepare(
        `INSERT INTO audit_event (id,actor_id,target_id,action,reason,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM content_permission WHERE user_id=? AND operation_id=?)`,
      ).bind(
        crypto.randomUUID(),
        c.get('actor').id,
        target,
        input.canEdit ? 'content_edit_granted' : 'content_edit_revoked',
        input.reason,
        Date.now(),
        target,
        operation,
      ),
    ]);
    if ((results[0]?.meta.changes ?? 0) + (results[1]?.meta.changes ?? 0) !== 1)
      throw new AccessError('STALE_STATE', '成员或权限已变化，请重新加载。', 409);
    return c.json({ success: true });
  })
  .post('/members', async (c) => {
    const input = nameInput.safeParse(await c.req.json().catch(() => null));
    if (!input.success) throw new AccessError('INVALID_INPUT', '请填写 1–40 字的成员名称。', 400);
    const id = crypto.randomUUID(),
      code = randomToken(),
      now = Date.now(),
      expiresAt = now + 86400_000;
    const actor = c.get('actor').id;
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO user (id, name, email, email_verified, created_at, updated_at, role, account_state) VALUES (?, ?, NULL, 0, ?, ?, 'member', 'pending')",
      ).bind(id, input.data.name, now, now),
      c.env.DB.prepare(
        "INSERT INTO account_claim (id,user_id,token_hash,purpose,expires_at,created_at,created_by) VALUES (?, ?, ?, 'activate', ?, ?, ?)",
      ).bind(crypto.randomUUID(), id, await hashToken(code), expiresAt, now, actor),
      c.env.DB.prepare(
        "INSERT INTO audit_event (id,actor_id,target_id,action,reason,created_at) VALUES (?, ?, ?, 'member_created', ?, ?)",
      ).bind(crypto.randomUUID(), actor, id, input.data.name, now),
    ]);
    return c.json(
      { id, code, link: tokenLink(c.env.APP_ORIGIN, 'activate', code), expiresAt },
      201,
    );
  })
  .post('/members/:id/credential', async (c) => {
    const input = reasonInput.safeParse(await c.req.json().catch(() => null));
    if (!input.success) throw new AccessError('INVALID_INPUT', '请填写操作原因。', 400);
    const target = await c.env.DB.prepare(
      'SELECT id, account_state, role, credential_version FROM user WHERE id=?',
    )
      .bind(c.req.param('id'))
      .first<{ id: string; account_state: string; role: string; credential_version: number }>();
    if (!target) throw new AccessError('NOT_FOUND', '成员不存在。', 404);
    if (target.role === 'admin')
      throw new AccessError('FORBIDDEN', '管理员账号的恢复请使用本机受控工具。', 403);
    const purpose = target.account_state === 'pending' ? 'activate' : 'reset';
    const code = randomToken(),
      now = Date.now(),
      expiresAt = now + (purpose === 'activate' ? 86400_000 : 3600_000);
    const operation = crypto.randomUUID();
    const guard = 'EXISTS (SELECT 1 FROM audit_event WHERE id=?)';
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO audit_event (id,actor_id,target_id,action,reason,created_at)
        SELECT ?,?,id,?,?,? FROM user WHERE id=? AND role='member' AND account_state=? AND credential_version=? AND ${adminAuthority}`,
      ).bind(
        operation,
        c.get('actor').id,
        `${purpose}_issued`,
        input.data.reason,
        now,
        target.id,
        target.account_state,
        target.credential_version,
        ...authorityValues(c.get('actor'), now),
      ),
      c.env.DB.prepare(
        `UPDATE account_claim SET revoked_at=? WHERE user_id=? AND used_at IS NULL AND revoked_at IS NULL AND ${guard}`,
      ).bind(now, target.id, operation),
      c.env.DB.prepare(
        `INSERT INTO account_claim (id,user_id,token_hash,purpose,expires_at,created_at,created_by) SELECT ?,?,?,?,?,?,? WHERE ${guard}`,
      ).bind(
        crypto.randomUUID(),
        target.id,
        await hashToken(code),
        purpose,
        expiresAt,
        now,
        c.get('actor').id,
        operation,
      ),
    ]);
    if (results[0]?.meta.changes !== 1)
      throw new AccessError('STALE_STATE', '账号或管理权限已变化，请重新加载。', 409);
    return c.json({ code, link: tokenLink(c.env.APP_ORIGIN, purpose, code), purpose, expiresAt });
  })
  .post('/members/:id/alias', async (c) => {
    const input = reasonInput
      .extend({ alias: loginAliasInput })
      .safeParse(await c.req.json().catch(() => null));
    if (!input.success)
      throw new AccessError('INVALID_INPUT', '请填写 11 位数字的登录别称和变更原因。', 400);
    const target = await c.env.DB.prepare(
      "SELECT id,credential_version FROM user WHERE id=? AND role='member' AND account_state='active'",
    )
      .bind(c.req.param('id'))
      .first<{ id: string; credential_version: number }>();
    if (!target) throw new AccessError('NOT_FOUND', '可修改的已激活成员不存在。', 404);
    const now = Date.now();
    const operation = crypto.randomUUID();
    const guard = 'EXISTS (SELECT 1 FROM audit_event WHERE id=?)';
    try {
      const results = await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO audit_event (id,actor_id,target_id,action,reason,created_at)
          SELECT ?,?,id,'alias_changed',?,? FROM user WHERE id=? AND role='member' AND account_state='active' AND credential_version=? AND ${adminAuthority}`,
        ).bind(
          operation,
          c.get('actor').id,
          input.data.reason,
          now,
          target.id,
          target.credential_version,
          ...authorityValues(c.get('actor'), now),
        ),
        c.env.DB.prepare(
          `UPDATE user SET login_alias=?, credential_version=credential_version+1, updated_at=? WHERE id=? AND ${guard}`,
        ).bind(input.data.alias, now, target.id, operation),
        c.env.DB.prepare(`DELETE FROM session WHERE user_id=? AND ${guard}`).bind(
          target.id,
          operation,
        ),
        c.env.DB.prepare(
          `UPDATE account_claim SET revoked_at=? WHERE user_id=? AND used_at IS NULL AND revoked_at IS NULL AND ${guard}`,
        ).bind(now, target.id, operation),
      ]);
      if (results[0]?.meta.changes !== 1)
        throw new AccessError('STALE_STATE', '账号或管理权限已变化，请重新加载。', 409);
    } catch (error) {
      if (aliasConflict(error)) throw new AccessError('ALIAS_TAKEN', '该登录别称已被使用。', 409);
      throw error;
    }
    return c.json({ success: true });
  })
  .route('/learning', learningAdmin)
  .route('/members', adminRoles)
  .route('/videos', videoAdmin);
