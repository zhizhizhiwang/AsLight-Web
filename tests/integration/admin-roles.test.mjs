import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { hashPassword } from 'better-auth/crypto';
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from 'miniflare';

const origin = 'http://127.0.0.1:5173';
const password = 'role-test-password-1234';
const memberPassword = 'member-test-password-5678';
test(
  'built Worker + D1: password-confirmed admin delegation, revocation, atomic races and credential preservation',
  { timeout: 120000 },
  async (t) => {
    const persistence = await mkdtemp(path.join(tmpdir(), 'aslight-roles-'));
    const assetModules = (await readdir('dist/aslight/assets'))
      .filter((n) => n.endsWith('.js'))
      .map((n) => ({ type: 'ESModule', path: path.resolve('dist/aslight/assets', n) }));
    const bindings = {
      APP_ORIGIN: origin,
      BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
    };
    const worker = () =>
      new Miniflare(
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
          outboundService: () => {
            throw Error('No external calls permitted in role tests');
          },
        }),
      );
    let mf = worker(),
      db = await mf.getD1Database('DB');
    t.after(async () => {
      await mf.dispose();
      await rm(persistence, { recursive: true, force: true });
    });
    const root = 'role-admin',
      b = 'role-member-b',
      c = 'role-member-c',
      d = 'role-member-d',
      pending = 'role-pending';
    const rootHash = await hashPassword(password),
      memberHash = await hashPassword(memberPassword);
    for (const file of (await readdir('migrations')).filter((n) => n.endsWith('.sql')).sort()) {
      if (file.startsWith('0011')) {
        const now = Date.now();
        for (const [index, id] of [root, b, c, d, pending].entries()) {
          await db
            .prepare(
              'INSERT INTO user(id,name,login_alias,role,account_state,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
            )
            .bind(
              id,
              `权限测试${index}`,
              `1110000020${index}`,
              index === 0 ? 'admin' : 'member',
              id === pending ? 'pending' : 'active',
              now,
              now,
            )
            .run();
          if (id !== pending)
            await db
              .prepare(
                "INSERT INTO account(id,account_id,user_id,provider_id,password,created_at,updated_at) VALUES(?,?,?,'credential',?,?,?)",
              )
              .bind(randomUUID(), id, id, id === b ? memberHash : rootHash, now, now)
              .run();
        }
        await db
          .prepare(
            "INSERT INTO progress(user_id,quest_id,learning_status,reward_status,version,updated_at) VALUES(?,'main-001','passed','pending',4,?)",
          )
          .bind(b, now)
          .run();
      }
      const sql = await readFile(path.join('migrations', file), 'utf8');
      await db.batch(
        sql
          .replaceAll('--> statement-breakpoint', '')
          .replace(/^--.*$/gm, '')
          .split(';')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => db.prepare(s)),
      );
    }
    assert.equal(
      (await db.prepare('SELECT role_version FROM user WHERE id=?').bind(b).first()).role_version,
      0,
    );
    assert.equal(
      (await db.prepare('SELECT password FROM account WHERE user_id=?').bind(b).first()).password,
      memberHash,
    );
    const progressBefore = await db
      .prepare('SELECT * FROM progress WHERE user_id=?')
      .bind(b)
      .first();
    const req = (url, cookie, body, requestOrigin = origin) =>
      mf.dispatchFetch(origin + url, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: requestOrigin,
          'cf-connecting-ip': '192.0.2.79',
          ...(cookie ? { Cookie: cookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const json = async (url, cookie, body, status = 200) => {
      const r = await req(url, cookie, body);
      assert.equal(r.status, status, url);
      return r.json();
    };
    const login = async (alias, pass = password) => {
      const r = await req('/api/auth/sign-in/alias', null, { alias, password: pass });
      assert.equal(r.status, 200);
      return r.headers
        .getSetCookie()
        .map((v) => v.split(';')[0])
        .join('; ');
    };
    const clearLimits = () => db.prepare('DELETE FROM throttle').run();
    const roleInput = (role = 'admin', expectedVersion = 0, pass = password) => ({
      role,
      expectedVersion,
      password: pass,
      reason: '站点管理授权测试',
    });
    const roleCount = async () =>
      (
        await db
          .prepare(
            "SELECT COUNT(*) AS n FROM audit_event WHERE action IN ('admin_granted','admin_revoked')",
          )
          .first()
      ).n;
    const getUser = (id) => db.prepare('SELECT * FROM user WHERE id=?').bind(id).first();
    let admin = await login('11100000200'),
      member = await login('11100000201', memberPassword);
    const memberOtherSession = await login('11100000201', memberPassword);
    await json(`/api/admin/members/${b}/role`, null, roleInput(), 401);
    await json(`/api/admin/members/${c}/role`, member, roleInput(), 403);
    assert.equal(
      (await req(`/api/admin/members/${b}/role`, admin, roleInput(), 'https://untrusted.example'))
        .status,
      403,
    );
    for (const input of [
      { ...roleInput(), role: 'owner' },
      { ...roleInput(), expectedVersion: -1 },
      { ...roleInput(), password: '' },
      { ...roleInput(), reason: '' },
      { ...roleInput(), actorId: root },
    ])
      await json(`/api/admin/members/${b}/role`, admin, input, 400);
    await json(`/api/admin/members/${root}/role`, admin, roleInput('member'), 403);
    await json(`/api/admin/members/${pending}/role`, admin, roleInput(), 409);
    await json('/api/admin/members/missing/role', admin, roleInput(), 409);
    await clearLimits();
    for (let i = 0; i < 5; i++) {
      const response = await json(
        `/api/admin/members/${b}/role`,
        admin,
        roleInput('admin', 0, memberPassword),
        403,
      );
      assert.equal(
        response.error.code,
        'REAUTH_FAILED',
        'must confirm actor password, never target password',
      );
    }
    await json(`/api/admin/members/${b}/role`, admin, roleInput(), 429);
    assert.equal(await roleCount(), 0);
    await clearLimits();
    await json(`/api/admin/members/${b}/content-permission`, admin, {
      canEdit: true,
      expectedVersion: 0,
      reason: '独立编辑权限',
    });
    const reset = await json(`/api/admin/members/${b}/credential`, admin, {
      reason: '提权前的成员恢复凭证',
    });
    const promoted = await Promise.all([
      req(`/api/admin/members/${b}/role`, admin, roleInput()),
      req(`/api/admin/members/${b}/role`, admin, roleInput()),
    ]);
    assert.deepEqual(promoted.map((r) => r.status).sort(), [200, 409]);
    await Promise.all(promoted.map((r) => r.arrayBuffer()));
    assert.equal(await roleCount(), 1);
    assert.equal((await getUser(b)).role, 'admin');
    assert.equal((await getUser(b)).role_version, 1);
    assert.equal((await getUser(b)).credential_version, 1);
    await json('/api/admin/members', member, undefined, 401);
    await json('/api/admin/members', memberOtherSession, undefined, 401);
    await json(
      '/api/access/reset-password',
      null,
      { code: reset.code, password: 'changed-member-pass-0000' },
      410,
    );
    assert.equal(
      (await db.prepare('SELECT password FROM account WHERE user_id=?').bind(b).first()).password,
      memberHash,
    );
    assert.deepEqual(
      await db.prepare('SELECT * FROM progress WHERE user_id=?').bind(b).first(),
      progressBefore,
    );
    await json(
      `/api/admin/members/${b}/credential`,
      admin,
      { reason: '管理员恢复必须走运维' },
      403,
    );
    await json(
      `/api/admin/members/${b}/alias`,
      admin,
      { reason: '管理员别称不可网页更改', alias: '11100000209' },
      404,
    );
    let second = await login('11100000201', memberPassword);
    let members = await json('/api/admin/members', second);
    assert.equal(members.members.find((u) => u.id === b).canEdit, true);
    await json(`/api/admin/members/${c}/role`, second, roleInput('admin', 0, memberPassword));
    assert.equal((await getUser(c)).role, 'admin', 'new admins can delegate');
    members = await json('/api/admin/members', admin);
    assert.equal(
      members.members.find((u) => u.id === c).canEdit,
      false,
      'admin does not grant content editing',
    );
    await clearLimits();
    // A recovery credential issued by operations must also be invalidated on demotion.
    const recovery = randomBytes(32).toString('base64url');
    await db
      .prepare(
        "INSERT INTO account_claim(id,user_id,token_hash,purpose,expires_at,created_at) VALUES(?,?,?,'reset',?,?)",
      )
      .bind(
        randomUUID(),
        b,
        createHash('sha256').update(recovery).digest('hex'),
        Date.now() + 3600000,
        Date.now(),
      )
      .run();
    await json(`/api/admin/members/${b}/role`, admin, roleInput('member', 1));
    await json('/api/admin/members', second, undefined, 401);
    await json(
      '/api/access/reset-password',
      null,
      { code: recovery, password: 'changed-member-pass-0000' },
      410,
    );
    assert.equal((await getUser(b)).role_version, 2);
    await json(`/api/admin/members/${b}/role`, admin, roleInput('admin', 0), 409);
    await json(`/api/admin/members/${b}/role`, admin, roleInput('admin', 1), 409);
    await json(`/api/admin/members/${b}/role`, admin, roleInput('admin', 2));
    second = await login('11100000201', memberPassword);
    await json(`/api/admin/members/${c}/role`, admin, roleInput('member', 1));
    await clearLimits();
    const previousAudits = await roleCount();
    const crossing = await Promise.all([
      req(`/api/admin/members/${b}/role`, admin, roleInput('member', 3)),
      req(`/api/admin/members/${root}/role`, second, roleInput('member', 0, memberPassword)),
    ]);
    assert.equal(
      crossing.filter((r) => r.status === 200).length,
      1,
      'only one reciprocal demotion may win',
    );
    assert.ok(crossing.every((r) => [200, 401, 403, 409].includes(r.status)));
    await Promise.all(crossing.map((r) => r.arrayBuffer()));
    assert.equal(
      (
        await db
          .prepare("SELECT COUNT(*) AS n FROM user WHERE role='admin' AND account_state='active'")
          .first()
      ).n,
      1,
    );
    assert.equal(await roleCount(), previousAudits + 1);
    const winner = (await getUser(root)).role === 'admin' ? root : b;
    const winnerCookie = winner === root ? admin : second,
      winnerPassword = winner === root ? password : memberPassword;
    await json(
      `/api/admin/members/${winner}/role`,
      winnerCookie,
      roleInput('member', (await getUser(winner)).role_version, winnerPassword),
      403,
    );
    await clearLimits();
    // Fail after the audit insert: the entire role/session/claim mutation must roll back.
    await db
      .prepare(
        `CREATE TRIGGER fail_role_change AFTER UPDATE OF role ON user WHEN NEW.id='${d}' BEGIN SELECT RAISE(ABORT,'role test rollback'); END`,
      )
      .run();
    const before = await roleCount();
    await json(
      `/api/admin/members/${d}/role`,
      winnerCookie,
      roleInput('admin', 0, winnerPassword),
      500,
    );
    assert.equal(await roleCount(), before);
    assert.equal((await getUser(d)).role, 'member');
    assert.equal((await getUser(d)).role_version, 0);
    await db.prepare('DROP TRIGGER fail_role_change').run();
    const [grant, issue, alias] = await Promise.all([
      req(`/api/admin/members/${d}/role`, winnerCookie, roleInput('admin', 0, winnerPassword)),
      req(`/api/admin/members/${d}/credential`, winnerCookie, { reason: '并发成员恢复' }),
      req(`/api/admin/members/${d}/alias`, winnerCookie, {
        reason: '并发别称修改',
        alias: '11100000209',
      }),
    ]);
    assert.equal(grant.status, 200);
    await grant.arrayBuffer();
    assert.ok([200, 403, 409].includes(issue.status));
    if (issue.status === 200) {
      const issued = await issue.json();
      await json(
        '/api/access/reset-password',
        null,
        { code: issued.code, password: 'changed-member-pass-0000' },
        410,
      );
    } else await issue.arrayBuffer();
    assert.ok([200, 404, 409].includes(alias.status));
    await alias.arrayBuffer();
    const roleAudit = await db
      .prepare("SELECT rowid FROM audit_event WHERE target_id=? AND action='admin_granted'")
      .bind(d)
      .first();
    const lateMemberAudits = await db
      .prepare(
        "SELECT COUNT(*) AS n FROM audit_event WHERE target_id=? AND action IN ('reset_issued','alias_changed') AND rowid>?",
      )
      .bind(d, roleAudit.rowid)
      .first();
    assert.equal(
      lateMemberAudits.n,
      0,
      'member recovery and alias changes cannot commit after promotion',
    );
    const audits = await db
      .prepare("SELECT * FROM audit_event WHERE action IN ('admin_granted','admin_revoked')")
      .all();
    assert.ok(audits.results.every((a) => a.actor_id && a.target_id && a.reason && a.created_at));
    assert.ok(!JSON.stringify(audits.results).includes(password));
    assert.ok(!JSON.stringify(audits.results).includes(memberPassword));
    assert.equal((await db.prepare('PRAGMA foreign_key_check').all()).results.length, 0);
    await mf.dispose();
    mf = worker();
    db = await mf.getD1Database('DB');
    assert.equal((await getUser(d)).role, 'admin');
    assert.equal((await getUser(d)).role_version, 1);
    assert.deepEqual(
      await db.prepare('SELECT * FROM progress WHERE user_id=?').bind(b).first(),
      progressBefore,
    );
  },
);
