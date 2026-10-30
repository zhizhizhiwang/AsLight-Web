import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from 'miniflare';
import { hashPassword } from 'better-auth/crypto';
import { adminProvisionSQL } from '../../scripts/admin-provision.mjs';

const origin = 'http://127.0.0.1:5173';
const password = 'test-only-password-1234';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const statements = (sql) =>
  sql
    .replaceAll('--> statement-breakpoint', '')
    .replace(/^--.*$/gm, '')
    .split(';')
    .map((value) => value.trim())
    .filter(Boolean);

test(
  'built Worker + D1: admin-created, no-email accounts and atomic activation/recovery',
  { timeout: 120000 },
  async (t) => {
    const persistence = await mkdtemp(path.join(tmpdir(), 'aslight-alias-'));
    const assetModules = (await readdir('dist/aslight/assets'))
      .filter((name) => name.endsWith('.js'))
      .map((name) => ({ type: 'ESModule', path: path.resolve('dist/aslight/assets', name) }));
    const bindings = {
      APP_ORIGIN: origin,
      BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
    };
    function worker() {
      return new Miniflare(
        convertV4MiniflareOptions({
          modules: [
            { type: 'ESModule', path: path.resolve('dist/aslight/index.js') },
            ...assetModules,
          ],
          modulesRoot: 'dist/aslight',
          compatibilityDate: '2026-10-19',
          compatibilityFlags: ['nodejs_compat'],
          bindings,
          d1Databases: ['DB'],
          resourcePersistencePath: persistence,
          log: new Log(LogLevel.ERROR),
        }),
      );
    }
    let mf = worker();
    t.after(async () => {
      await mf.dispose();
      await rm(persistence, { recursive: true, force: true });
    });
    let db = await mf.getD1Database('DB');
    const execute = (sql) => db.batch(statements(sql).map((sql) => db.prepare(sql)));
    for (const file of (await readdir('migrations'))
      .filter((name) => name.endsWith('.sql'))
      .sort()) {
      if (file.startsWith('0002')) {
        const now = Date.now();
        await db.batch([
          db
            .prepare(
              "INSERT INTO user (id,name,email,email_verified,created_at,updated_at,role) VALUES ('legacy-user','旧成员','legacy@example.test',1,?,?,'member')",
            )
            .bind(now, now),
          db
            .prepare(
              "INSERT INTO account (id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES ('legacy-credential','legacy-user','credential','legacy-user',?,?,?)",
            )
            .bind(await hashPassword(password), now, now),
          db
            .prepare("INSERT INTO progress VALUES ('legacy-user','main-001','passed','pending',?)")
            .bind(now),
          db
            .prepare(
              "INSERT INTO session (id,expires_at,token,created_at,updated_at,user_id) VALUES ('legacy-session',?,'old-test-token',?,?,'legacy-user')",
            )
            .bind(now + 1000000, now, now),
        ]);
      }
      await execute(await readFile(path.join('migrations', file), 'utf8'));
    }
    assert.equal(
      (await db.prepare("SELECT email FROM user WHERE id='legacy-user'").first()).email,
      'legacy@example.test',
    );
    assert.equal(
      (await db.prepare("SELECT learning_status FROM progress WHERE user_id='legacy-user'").first())
        .learning_status,
      'passed',
      'migration preserves progress and user identity',
    );
    assert.equal(
      (await db.prepare("SELECT user_id FROM account WHERE id='legacy-credential'").first())
        .user_id,
      'legacy-user',
      'migration preserves credentials',
    );
    assert.equal(
      (await db.prepare('SELECT COUNT(*) AS n FROM session').first()).n,
      0,
      'migration intentionally signs old sessions out',
    );
    assert.equal((await db.prepare('PRAGMA foreign_key_check').all()).results.length, 0);

    async function request(
      url,
      { body, cookie, ip = '192.0.2.10', requestOrigin = origin, method } = {},
    ) {
      return mf.dispatchFetch(`${origin}${url}`, {
        method: method ?? (body === undefined ? 'GET' : 'POST'),
        headers: {
          'Content-Type': 'application/json',
          Origin: requestOrigin,
          'cf-connecting-ip': ip,
          ...(cookie ? { Cookie: cookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'manual',
      });
    }
    async function json(url, options, expected = 200) {
      const r = await request(url, options);
      assert.equal(r.status, expected, `status for ${url}`);
      return r.json();
    }
    async function provision(mode = 'bootstrap') {
      const code = randomBytes(32).toString('base64url'),
        claimId = randomUUID();
      await execute(
        adminProvisionSQL({
          mode,
          userId: randomUUID(),
          claimId,
          tokenHash: hash(code),
          eventId: randomUUID(),
          now: Date.now(),
        }),
      );
      return { code, claimId };
    }
    async function login(alias, pass = password) {
      const response = await request('/api/auth/sign-in/alias', {
        body: { alias, password: pass },
      });
      assert.equal(response.status, 200, 'activated alias can log in');
      assert.match(response.headers.get('set-cookie') ?? '', /HttpOnly/i);
      assert.equal(
        'token' in (await response.json()),
        false,
        'session token is confined to cookie',
      );
      return response.headers
        .getSetCookie()
        .map((entry) => entry.split(';')[0])
        .join('; ');
    }
    const activate = (code, alias, name = '测试成员', extra = {}) =>
      request('/api/access/activate', {
        ip: '192.0.2.20',
        body: { code, alias, name, password, ...extra },
      });
    const map = (cookie) => json('/api/member/quest-map', { cookie });
    const issue = (id, cookie, reason = '测试中的人工身份确认') =>
      json(`/api/admin/members/${id}/credential`, { cookie, body: { reason } });
    assert.equal((await request('/api/admin/members')).status, 401);
    const boot = await provision();
    const duplicate = await provision();
    assert.equal(
      (await db.prepare("SELECT COUNT(*) AS n FROM user WHERE role='admin'").first()).n,
      1,
      'bootstrap never replaces an existing administrator',
    );
    assert.equal(
      await db.prepare('SELECT id FROM account_claim WHERE id=?').bind(duplicate.claimId).first(),
      null,
    );
    assert.equal(
      (await activate(boot.code, '00000000001', '测试管理员')).status,
      200,
      'alias is any eleven digits, not a real phone validation',
    );
    let adminCookie = await login('00000000001');
    const session = await json('/api/auth/get-session', { cookie: adminCookie });
    assert.equal('email' in session.user, false, 'no synthetic email is returned');
    assert.equal(session.user.role, 'admin');
    assert.equal(
      (
        await db
          .prepare('SELECT email,email_verified FROM user WHERE id=?')
          .bind(session.user.id)
          .first()
      ).email,
      null,
    );
    for (const route of [
      '/api/auth/sign-up/email',
      '/api/auth/sign-in/email',
      '/api/auth/request-password-reset',
      '/api/auth/send-verification-email',
      '/api/auth/phone-number/send-otp',
      '/api/auth/update-user',
    ]) {
      assert.equal(
        (await request(route, { body: {} })).status,
        404,
        'email/OTP/self-provisioning endpoints are absent',
      );
    }
    assert.equal(
      (
        await request('/api/admin/members', {
          cookie: adminCookie,
          requestOrigin: 'https://evil.example',
          body: { name: '不可创建' },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request('/api/admin/members', {
          cookie: adminCookie,
          body: { name: '越权', role: 'admin' },
        })
      ).status,
      400,
    );
    const a = await json(
      '/api/admin/members',
      { cookie: adminCookie, body: { name: '待激活甲' } },
      201,
    );
    const b = await json(
      '/api/admin/members',
      { cookie: adminCookie, body: { name: '待激活乙' } },
      201,
    );
    assert.ok(
      new URL(a.link).hash.startsWith('#code='),
      'bearer credential is in fragment, not server query',
    );
    assert.equal(
      (await db.prepare('SELECT COUNT(*) AS n FROM user WHERE email IS NULL').first()).n,
      3,
      'multiple no-email accounts coexist',
    );
    const aNext = await issue(a.id, adminCookie);
    assert.equal(
      (await activate(a.code, '11100000001')).status,
      410,
      'reissued activation invalidates older code',
    );
    await db
      .prepare('UPDATE account_claim SET expires_at=0 WHERE token_hash=?')
      .bind(hash(b.code))
      .run();
    assert.equal(
      (await activate(b.code, '11100000002')).status,
      410,
      'expired activation is rejected',
    );
    const bNext = await issue(b.id, adminCookie);
    assert.equal((await activate(aNext.code, '123')).status, 400);
    assert.equal((await activate(aNext.code, '11100000001', '甲', { role: 'admin' })).status, 400);
    const parallel = await Promise.all(
      Array.from({ length: 4 }, () => activate(aNext.code, '11100000001', '甲')),
    );
    assert.equal(
      parallel.filter((r) => r.status === 200).length,
      1,
      'only one concurrent activation can win',
    );
    assert.ok(parallel.every((r) => [200, 410].includes(r.status)));
    // Different address prevents the independent per-IP activation limit masking the conflict test.
    const bActivate = (alias) =>
      request('/api/access/activate', {
        ip: '192.0.2.21',
        body: { code: bNext.code, alias, name: '乙', password },
      });
    assert.equal((await bActivate('11100000001')).status, 409);
    assert.equal(
      (
        await db
          .prepare('SELECT used_at FROM account_claim WHERE token_hash=?')
          .bind(hash(bNext.code))
          .first()
      ).used_at,
      null,
      'alias conflict rolls token consumption back',
    );
    assert.equal((await bActivate('11100000002')).status, 200);
    const cookieA = await login('11100000001'),
      cookieB = await login('11100000002');
    assert.equal(
      (await json('/api/auth/get-session', { cookie: cookieA })).user.id,
      a.id,
      'activation keeps precreated user ID',
    );
    assert.equal((await request('/api/admin/members', { cookie: cookieA })).status, 403);
    assert.equal(
      (
        await request(`/api/admin/members/${b.id}/credential`, {
          cookie: cookieA,
          body: { reason: '越权' },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request(`/api/admin/members/${session.user.id}/credential`, {
          cookie: adminCookie,
          body: { reason: '禁止网页恢复管理员' },
        })
      ).status,
      403,
    );
    assert.equal((await map()).progress, null);
    assert.equal(
      (await request('/api/member/quests/main-002/start', { cookie: cookieA, body: {} })).status,
      409,
    );
    assert.equal(
      (
        await request('/api/member/quests/main-001/start', {
          cookie: cookieA,
          body: { userId: b.id, learningStatus: 'passed' },
        })
      ).status,
      400,
    );
    const starts = await Promise.all(
      Array.from({ length: 4 }, () =>
        request('/api/member/quests/main-001/start', { cookie: cookieA, body: {} }),
      ),
    );
    assert.ok(starts.every((r) => r.status === 200));
    assert.equal(
      (await db.prepare('SELECT COUNT(*) AS n FROM progress WHERE user_id=?').bind(a.id).first()).n,
      1,
    );
    assert.equal((await map(cookieA)).progress[0].learningStatus, 'in_progress');
    assert.ok((await map(cookieB)).progress.every((row) => row.learningStatus === 'not_started'));
    assert.equal(
      (await request('/api/member/quests/main-001/pass', { cookie: cookieA, body: {} })).status,
      404,
    );
    await db
      .prepare(
        "UPDATE progress SET learning_status='passed',reward_status='pending' WHERE user_id=?",
      )
      .bind(a.id)
      .run();
    assert.equal(
      (await map(cookieA)).progress.find((row) => row.questId === 'main-002').unlocked,
      true,
    );
    await mf.dispose();
    mf = worker();
    db = await mf.getD1Database('DB');
    assert.equal(
      (await map(cookieA)).progress[0].learningStatus,
      'passed',
      'data and session persist through Worker restart',
    );
    const legacy = await issue('legacy-user', adminCookie);
    assert.equal(
      (
        await request('/api/access/activate', {
          ip: '192.0.2.22',
          body: { code: legacy.code, alias: '11100000003', name: '旧成员', password },
        })
      ).status,
      200,
    );
    assert.equal(
      (await map(await login('11100000003'))).progress[0].learningStatus,
      'passed',
      'old progress survives activation on original user ID',
    );

    const resetOld = await issue(a.id, adminCookie),
      resetNew = await issue(a.id, adminCookie);
    const nextPassword = 'test-new-password-456789';
    assert.equal(
      (
        await request('/api/access/reset-password', {
          body: { code: resetOld.code, password: nextPassword },
        })
      ).status,
      410,
    );
    const stale = await db
      .prepare('SELECT * FROM session WHERE user_id=? ORDER BY created_at LIMIT 1')
      .bind(a.id)
      .first();
    assert.equal(
      (
        await request('/api/access/reset-password', {
          body: { code: resetNew.code, password: nextPassword },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request('/api/access/reset-password', {
          body: { code: resetNew.code, password: nextPassword },
        })
      ).status,
      410,
    );
    assert.equal((await map(cookieA)).progress, null, 'password reset revokes existing sessions');
    // A session created late by a racing old-password login still has an old version.
    await db
      .prepare(
        'INSERT INTO session (id,expires_at,token,created_at,updated_at,ip_address,user_agent,user_id,credential_version) VALUES (?,?,?,?,?,?,?,?,?)',
      )
      .bind(
        stale.id,
        stale.expires_at,
        stale.token,
        stale.created_at,
        stale.updated_at,
        stale.ip_address,
        stale.user_agent,
        stale.user_id,
        stale.credential_version,
      )
      .run();
    assert.equal(
      await json('/api/auth/get-session', { cookie: cookieA }),
      null,
      'stale credential-version sessions cannot return identity',
    );
    assert.equal(
      (await map(cookieA)).progress,
      null,
      'stale credential-version sessions cannot access progress',
    );
    assert.equal(
      (await request('/api/auth/sign-in/alias', { body: { alias: '11100000001', password } }))
        .status,
      401,
    );
    const freshA = await login('11100000001', nextPassword);
    assert.equal((await map(freshA)).progress[0].learningStatus, 'passed');
    assert.ok((await map(cookieB)).progress, 'resetting A does not revoke B');
    assert.equal(
      (
        await request(`/api/admin/members/${b.id}/alias`, {
          cookie: adminCookie,
          body: { alias: '11100000001', reason: '冲突测试' },
        })
      ).status,
      409,
    );
    assert.ok((await map(cookieB)).progress, 'failed alias update preserves sessions');
    const bReset = await issue(b.id, adminCookie);
    assert.equal(
      (
        await request(`/api/admin/members/${b.id}/alias`, {
          cookie: adminCookie,
          body: { alias: '11100000022', reason: '本人确认换号' },
        })
      ).status,
      200,
    );
    assert.equal((await map(cookieB)).progress, null);
    assert.equal(
      (
        await request('/api/access/reset-password', {
          body: { code: bReset.code, password: nextPassword },
        })
      ).status,
      410,
    );
    const freshB = await login('11100000022');
    const anotherA = await login('11100000001', nextPassword);
    assert.equal(
      (await request('/api/auth/revoke-other-sessions', { cookie: anotherA, body: {} })).status,
      200,
    );
    assert.equal((await map(freshA)).progress, null);
    assert.equal((await request('/api/auth/sign-out', { cookie: freshB, body: {} })).status, 200);
    assert.equal((await map(freshB)).progress, null);
    const recoverAdmin = await provision('recover');
    assert.equal(
      (
        await request('/api/access/reset-password', {
          body: { code: recoverAdmin.code, password: nextPassword },
        })
      ).status,
      200,
    );
    assert.equal((await request('/api/admin/members', { cookie: adminCookie })).status, 401);
    adminCookie = await login('00000000001', nextPassword);
    const members = await json('/api/admin/members', { cookie: adminCookie });
    assert.ok(
      members.members.every((m) => !m.alias || m.alias.includes('****')),
      'admin listing masks aliases',
    );
    const audits = (await db.prepare('SELECT action,reason FROM audit_event').all()).results;
    assert.ok(
      audits.some((row) => row.action === 'password_reset') &&
        audits.some((row) => row.action === 'alias_changed'),
    );
    assert.ok(!JSON.stringify(audits).includes(aNext.code), 'audit never stores a raw credential');
    assert.equal(
      (await db.prepare('SELECT COUNT(*) AS n FROM local_mail').first()).n,
      0,
      'no mail was generated',
    );
    const limited = await Promise.all(
      Array.from({ length: 12 }, () =>
        request('/api/access/activate', { ip: '192.0.2.250', body: {} }),
      ),
    );
    assert.ok(limited.some((r) => r.status === 429));
    assert.ok(
      limited.filter((r) => r.status !== 429).length <= 10,
      'limit remains atomic under concurrency',
    );
  },
);
