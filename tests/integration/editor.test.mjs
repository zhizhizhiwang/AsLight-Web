import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from 'miniflare';
import { adminProvisionSQL } from '../../scripts/admin-provision.mjs';

const origin = 'http://127.0.0.1:5173',
  password = 'editor-test-only-1234';
const statements = (sql) =>
  sql
    .replaceAll('--> statement-breakpoint', '')
    .replace(/^--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

test(
  'built Worker + D1: live editing, separate permissions, atomic saves, conflicts and history preservation',
  { timeout: 120000 },
  async (t) => {
    const persistence = await mkdtemp(path.join(tmpdir(), 'aslight-editor-'));
    const assets = (await readdir('dist/aslight/assets'))
      .filter((n) => n.endsWith('.js'))
      .map((n) => ({ type: 'ESModule', path: path.resolve('dist/aslight/assets', n) }));
    const bindings = {
      APP_ORIGIN: origin,
      BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
    };
    const worker = () =>
      new Miniflare(
        convertV4MiniflareOptions({
          modules: [{ type: 'ESModule', path: path.resolve('dist/aslight/index.js') }, ...assets],
          modulesRoot: 'dist/aslight',
          compatibilityDate: '2026-10-19',
          compatibilityFlags: ['nodejs_compat'],
          bindings,
          d1Databases: ['DB'],
          resourcePersistencePath: persistence,
          log: new Log(LogLevel.ERROR),
        }),
      );
    let mf = worker(),
      db = await mf.getD1Database('DB');
    t.after(async () => {
      await mf.dispose();
      await rm(persistence, { recursive: true, force: true });
    });
    const execute = (sql) => db.batch(statements(sql).map((s) => db.prepare(s)));
    for (const file of (await readdir('migrations')).filter((n) => n.endsWith('.sql')).sort())
      await execute(await readFile(path.join('migrations', file), 'utf8'));
    const request = (url, cookie, body, requestOrigin = origin) =>
      mf.dispatchFetch(`${origin}${url}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: requestOrigin,
          'cf-connecting-ip': '192.0.2.88',
          ...(cookie ? { Cookie: cookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const json = async (url, cookie, body, status = 200) => {
      const res = await request(url, cookie, body);
      assert.equal(res.status, status, `${url}: ${await res.clone().text()}`);
      return res.json();
    };
    async function activate(code, alias, name) {
      await json('/api/access/activate', null, { code, alias, name, password });
      const res = await request('/api/auth/sign-in/alias', null, { alias, password });
      assert.equal(res.status, 200);
      return res.headers
        .getSetCookie()
        .map((s) => s.split(';')[0])
        .join('; ');
    }
    const adminId = randomUUID(),
      code = randomBytes(32).toString('base64url');
    await execute(
      adminProvisionSQL({
        mode: 'bootstrap',
        userId: adminId,
        claimId: randomUUID(),
        tokenHash: createHash('sha256').update(code).digest('hex'),
        eventId: randomUUID(),
        now: Date.now(),
      }),
    );
    const admin = await activate(code, '11100000201', '编辑测试管理员');
    const a = await json('/api/admin/members', admin, { name: '内容编辑测试' }, 201),
      b = await json('/api/admin/members', admin, { name: '普通成员测试' }, 201);
    const editor = await activate(a.code, '11100000202', '内容编辑测试'),
      member = await activate(b.code, '11100000203', '普通成员测试');
    await json('/api/content/course', null, undefined, 401);
    await json('/api/content/course', admin, undefined, 403);
    assert.deepEqual(await json('/api/content/access', member), { canEdit: false });
    await json(
      `/api/admin/members/${a.id}/content-permission`,
      member,
      { canEdit: true, expectedVersion: 0, reason: '越权' },
      403,
    );
    await json(`/api/admin/members/${a.id}/content-permission`, admin, {
      canEdit: true,
      expectedVersion: 0,
      reason: '负责课程编排',
    });
    await json(
      `/api/admin/members/${a.id}/content-permission`,
      admin,
      { canEdit: false, expectedVersion: 0, reason: '过时权限' },
      409,
    );
    await json('/api/admin/members', editor, undefined, 403);
    await json('/api/admin/learning/members', editor, undefined, 403);
    assert.equal(
      (await db.prepare('SELECT role FROM user WHERE id=?').bind(a.id).first()).role,
      'member',
    );
    const initial = await json('/api/content/course', editor);
    const payload = (document) => ({
      expectedRevision: initial.revision,
      requestId: randomUUID(),
      reason: '测试修改',
      document: structuredClone(document),
    });
    const draft = structuredClone(initial.document);
    draft.chapters.push({
      id: 'new-chapter',
      title: '新增章节',
      description: '',
      sortOrder: 1,
      icon: '二',
      archived: false,
      presentation: {
        decorations: [
          {
            id: 'note',
            type: 'text',
            text: '任务内容待添加',
            position: { x: 0, y: -80 },
            width: 240,
            height: 60,
            layer: 0,
          },
        ],
      },
    });
    draft.quests.push({
      id: 'new-task',
      chapterId: 'new-chapter',
      title: '主线1',
      summary: '任务内容待添加',
      kind: 'main',
      prerequisites: ['main-001'],
      prerequisiteMode: 'any',
      position: { x: 100, y: 100 },
      archived: false,
      content: [
        { type: 'paragraph', text: '任务内容待添加'.repeat(1200) },
        { type: 'paragraph', text: '任务内容待添加'.repeat(1200) },
      ],
    });
    const save = payload(draft);
    assert.equal(
      (await request('/api/content/course', editor, save, 'https://untrusted.example')).status,
      403,
    );
    await json('/api/content/course', member, save, 403);
    const changed = await json('/api/content/course', editor, save);
    assert.equal(changed.revision, 1);
    const publicMap = await json('/api/member/quest-map');
    assert.equal(publicMap.map.chapters.at(-1).title, '新增章节');
    assert.equal(publicMap.progress, null);
    assert.equal(
      (await json('/api/content/course', editor, save)).revision,
      1,
      'same request must not create another revision',
    );
    await json('/api/content/course', editor, { ...save, reason: '不同请求' }, 409);
    await json('/api/content/course', editor, payload(initial.document), 409);
    const invalid = structuredClone(changed.document);
    invalid.quests.find((q) => q.id === 'main-001').prerequisites = ['new-task'];
    await json('/api/content/course', editor, { ...payload(invalid), expectedRevision: 1 }, 400);
    const missing = structuredClone(changed.document);
    missing.quests = missing.quests.filter((q) => q.id !== 'new-task');
    await json('/api/content/course', editor, { ...payload(missing), expectedRevision: 1 }, 400);
    const unsafe = structuredClone(changed.document);
    unsafe.quests[0].imageAssetId = 'unregistered';
    await json('/api/content/course', editor, { ...payload(unsafe), expectedRevision: 1 }, 400);
    await json(
      '/api/content/course',
      editor,
      {
        ...payload(changed.document),
        expectedRevision: 1,
        document: {
          ...changed.document,
          quests: changed.document.quests.map((q) => ({ ...q, rewardLabel: '不可编辑奖励' })),
        },
      },
      400,
    );
    const left = { ...payload(changed.document), expectedRevision: 1 },
      right = { ...payload(changed.document), expectedRevision: 1 };
    left.document.chapters[0].title = '修改甲';
    right.document.chapters[0].title = '修改乙';
    const races = await Promise.all([
      request('/api/content/course', editor, left),
      request('/api/content/course', editor, right),
    ]);
    assert.deepEqual(races.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM course_change').first()).n, 2);
    // Save and business history must survive process restart.
    await json('/api/member/quests/main-001/start', member, {});
    await json('/api/admin/learning/quests/main-001/reward', admin, {
      expectedVersion: 0,
      label: '测试奖励',
    });
    await json(`/api/admin/learning/members/${b.id}/quests/main-001/review`, admin, {
      requestId: randomUUID(),
      expectedVersion: 0,
      expectedAttemptId: null,
      decision: 'passed',
      feedback: '',
      assessedAt: Date.now(),
    });
    const historyBefore = await Promise.all(
      ['assessment_attempt', 'assessment_review', 'reward_grant'].map(
        async (table) => (await db.prepare(`SELECT * FROM ${table}`).all()).results,
      ),
    );
    const progressBefore = (
      await db.prepare('SELECT * FROM progress WHERE user_id=?').bind(b.id).all()
    ).results;
    const fresh = await json('/api/content/course', editor),
      rule = structuredClone(fresh.document);
    rule.quests.find((q) => q.id === 'main-001').assessmentContent = [
      { type: 'paragraph', text: '新的考核要求' },
    ];
    await json(
      '/api/content/course',
      editor,
      { ...payload(rule), expectedRevision: fresh.revision },
      409,
    );
    const archive = structuredClone(fresh.document);
    archive.chapters.forEach((c) => (c.archived = true));
    archive.quests[0].position.x += 20;
    const archived = await json('/api/content/course', editor, {
      ...payload(archive),
      expectedRevision: fresh.revision,
    });
    assert.deepEqual((await json('/api/member/quest-map')).map.chapters, []);
    assert.deepEqual(
      await Promise.all(
        ['assessment_attempt', 'assessment_review', 'reward_grant'].map(
          async (table) => (await db.prepare(`SELECT * FROM ${table}`).all()).results,
        ),
      ),
      historyBefore,
    );
    assert.equal(
      (await db.prepare("SELECT reward_label FROM quest WHERE id='main-001'").first()).reward_label,
      '测试奖励',
    );
    assert.deepEqual(
      (await db.prepare('SELECT * FROM progress WHERE user_id=?').bind(b.id).all()).results,
      progressBefore,
    );
    // D1 batch rollback: audit failure must also roll back revision, chapter and quest writes.
    await db
      .prepare(
        "CREATE TRIGGER fail_course_change BEFORE INSERT ON course_change BEGIN SELECT RAISE(ABORT,'forced rollback'); END",
      )
      .run();
    const rollback = structuredClone(archived.document);
    rollback.chapters[0].title = '不应保留';
    await json(
      '/api/content/course',
      editor,
      { ...payload(rollback), expectedRevision: archived.revision },
      500,
    );
    assert.deepEqual(await json('/api/content/course', editor), archived);
    await execute('DROP TRIGGER fail_course_change');
    await json(`/api/admin/members/${a.id}/content-permission`, admin, {
      canEdit: false,
      expectedVersion: 1,
      reason: '撤销测试',
    });
    await json(
      '/api/content/course',
      editor,
      { ...payload(archived.document), expectedRevision: archived.revision },
      403,
    );
    assert.equal(
      (
        await db
          .prepare(
            "SELECT COUNT(*) n FROM audit_event WHERE action IN ('content_edit_granted','content_edit_revoked')",
          )
          .first()
      ).n,
      2,
    );
    await mf.dispose();
    mf = worker();
    db = await mf.getD1Database('DB');
    assert.equal(
      (await db.prepare("SELECT revision FROM course_revision WHERE id='current'").first())
        .revision,
      archived.revision,
    );
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM course_change').first()).n, 3);
    assert.deepEqual(
      (await db.prepare('SELECT * FROM progress WHERE user_id=?').bind(b.id).all()).results,
      progressBefore,
    );
  },
);
