import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from 'miniflare';
import { adminProvisionSQL } from '../../scripts/admin-provision.mjs';

const origin = 'http://127.0.0.1:5173';
const password = 'learning-test-only-1234';
const statements = (sql) =>
  sql
    .replaceAll('--> statement-breakpoint', '')
    .replace(/^--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

test(
  'built Worker + D1: offline assessment, immutable retries, rewards, permissions and atomic races',
  { timeout: 120000 },
  async (t) => {
    const persistence = await mkdtemp(path.join(tmpdir(), 'aslight-learning-'));
    const assetModules = (await readdir('dist/aslight/assets'))
      .filter((name) => name.endsWith('.js'))
      .map((name) => ({ type: 'ESModule', path: path.resolve('dist/aslight/assets', name) }));
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
        }),
      );
    let mf = worker();
    t.after(async () => {
      await mf.dispose();
      await rm(persistence, { recursive: true, force: true });
    });
    let db = await mf.getD1Database('DB');
    const execute = (sql) => db.batch(statements(sql).map((s) => db.prepare(s)));
    for (const file of (await readdir('migrations')).filter((name) => name.endsWith('.sql')).sort())
      await execute(await readFile(path.join('migrations', file), 'utf8'));
    const request = (url, cookie, body, requestOrigin = origin) =>
      mf.dispatchFetch(`${origin}${url}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: requestOrigin,
          'cf-connecting-ip': '192.0.2.70',
          ...(cookie ? { Cookie: cookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    async function json(url, cookie, body, status = 200) {
      const response = await request(url, cookie, body);
      assert.equal(response.status, status, `status for ${url}`);
      return response.json();
    }
    async function activate(code, alias, name) {
      await json('/api/access/activate', null, { code, alias, name, password });
      const response = await request('/api/auth/sign-in/alias', null, { alias, password });
      assert.equal(response.status, 200);
      return response.headers
        .getSetCookie()
        .map((item) => item.split(';')[0])
        .join('; ');
    }
    const code = randomBytes(32).toString('base64url');
    const adminId = randomUUID();
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
    const admin = await activate(code, '11100000101', '测试管理员');
    const a = await json('/api/admin/members', admin, { name: '测试成员甲' }, 201);
    const b = await json('/api/admin/members', admin, { name: '测试成员乙' }, 201);
    const member = await activate(a.code, '11100000102', '测试成员甲');
    const other = await activate(b.code, '11100000103', '测试成员乙');
    // Real multi-chapter fixtures; no sample personal progress is returned to anonymous readers.
    await db.batch([
      db.prepare(
        "INSERT INTO chapter (id,title,description,sort_order,icon) VALUES ('second','第二章','任务内容待添加',1,'二'),('empty','空章节','',2,NULL)",
      ),
      db.prepare(
        "INSERT INTO chapter (id,title,description,status) VALUES ('draft','草稿章节','','draft'),('archived','归档章节','','archived')",
      ),
      ...['second', 'draft', 'archived'].map((chapterId) =>
        db.prepare('INSERT INTO quest (id,chapter_id,definition) VALUES (?,?,?)').bind(
          `task-${chapterId}`,
          chapterId,
          JSON.stringify({
            id: `task-${chapterId}`,
            chapterId,
            title: '主线1',
            summary: '任务内容待添加',
            kind: 'main',
            prerequisites: chapterId === 'second' ? ['main-001'] : [],
            prerequisiteMode: 'all',
            position: { x: 100, y: 100 },
          }),
        ),
      ),
    ]);
    const presentation = {
      iconAssetId: 'public-image',
      backgroundAssetId: 'public-image',
      viewport: { x: 20, y: 40, zoom: 1 },
      decorations: [
        {
          id: 'note',
          type: 'text',
          text: '任务内容待添加',
          position: { x: 40, y: -100 },
          width: 300,
          height: 80,
          layer: 0,
        },
        {
          id: 'image',
          type: 'image',
          assetId: 'draft-image',
          alt: '图片待发布',
          position: { x: 40, y: 200 },
          width: 100,
          height: 100,
          layer: 1,
        },
      ],
    };
    await db.batch([
      db
        .prepare("UPDATE chapter SET presentation=? WHERE id='second'")
        .bind(JSON.stringify(presentation)),
      db.prepare(
        "INSERT INTO course_asset (id,path,alt,width,height,status) VALUES ('public-image','/course-assets/test.svg','图片说明',640,360,'published'),('draft-image','/course-assets/unpublished.png','未发布图片',100,100,'draft'),('unsafe-image','/uploads/private.png','私有作业',100,100,'published'),('unused-image','/course-assets/unused.png','未引用图片',100,100,'published')",
      ),
      db
        .prepare(
          "UPDATE quest SET definition=json_set(definition,'$.imageAssetId','public-image','$.content',json(?),'$.assessmentContent',json(?)) WHERE id='task-second'",
        )
        .bind(
          JSON.stringify([
            { type: 'heading', text: '任务内容待添加' },
            { type: 'paragraph', text: '<img src=x onerror=alert(1)>' },
            { type: 'image', assetId: 'public-image', alt: '图片说明', caption: '图片说明待添加' },
            { type: 'image', assetId: 'missing-image', alt: '图片暂不可用' },
          ]),
          JSON.stringify([
            { type: 'list', ordered: true, items: ['任务内容待添加'] },
            { type: 'image', assetId: 'unsafe-image', alt: '图片暂不可用' },
          ]),
        ),
    ]);
    const anonymousCourse = await json('/api/member/quest-map');
    assert.deepEqual(
      anonymousCourse.map.assets.map((item) => item.id),
      ['public-image'],
    );
    assert.deepEqual(anonymousCourse.map.chapters[1].presentation, presentation);
    assert.equal(
      anonymousCourse.map.quests.find((item) => item.id === 'task-second').content[0].type,
      'heading',
    );
    for (const forbidden of ['/uploads/', '/unpublished.png', '/unused.png'])
      assert.ok(!JSON.stringify(anonymousCourse).includes(forbidden));
    assert.equal(anonymousCourse.progress, null);
    assert.deepEqual(
      anonymousCourse.map.chapters.map((item) => item.id),
      ['chapter-001', 'second', 'empty'],
    );
    assert.equal(anonymousCourse.map.chapters[1].icon, '二');
    assert.ok(!JSON.stringify(anonymousCourse).includes('task-draft'));
    assert.ok(!JSON.stringify(anonymousCourse).includes('task-archived'));
    for (const id of ['task-draft', 'task-archived', 'missing']) {
      await json(`/api/member/quests/${id}/start`, member, {}, 404);
      await json(`/api/member/quests/${id}/learning`, member, undefined, 404);
    }
    await json('/api/member/quests/task-second/start', member, {}, 409);
    const detailPath = '/api/member/quests/main-001/learning';
    const applyPath = '/api/member/quests/main-001/assessments';
    const reviewPath = `/api/admin/learning/members/${a.id}/quests/main-001/review`;
    const settingPath = '/api/admin/learning/quests/main-001/reward';
    const workspace = `/api/admin/learning/members/${a.id}`;
    const baseReview = {
      requestId: randomUUID(),
      expectedVersion: 0,
      expectedAttemptId: null,
      decision: 'passed',
      feedback: '',
      assessedAt: Date.now(),
    };
    await json(workspace, null, undefined, 401);
    await json(workspace, member, undefined, 403);
    await json(reviewPath, member, baseReview, 403);
    await json(settingPath, member, { expectedVersion: 0, label: '测试奖励' }, 403);
    await json(detailPath, null, undefined, 401);
    await json(applyPath, member, { requestId: randomUUID(), expectedVersion: 0, note: '' }, 409);
    await json(reviewPath, admin, baseReview, 409);
    assert.equal(
      (await request(reviewPath, admin, baseReview, 'https://untrusted.test')).status,
      403,
    );
    await json('/api/member/quests/main-002/start', member, {}, 409);
    await json('/api/member/quests/main-001/start', member, {});
    await json(reviewPath, admin, { ...baseReview, decision: 'needs_revision' }, 400);
    await json(reviewPath, admin, { ...baseReview, assessedAt: Date.now() + 3600000 }, 400);
    await json(settingPath, admin, { expectedVersion: 0, label: '集成测试奖励甲' });
    const submission = { requestId: randomUUID(), expectedVersion: 0, note: '申请备注测试' };
    await json(applyPath, member, { ...submission, userId: b.id }, 400);
    const submitted = await Promise.all([
      request(applyPath, member, submission),
      request(applyPath, member, submission),
    ]);
    assert.deepEqual(
      submitted.map((r) => r.status),
      [200, 200],
      'repeated request is idempotent',
    );
    let detail = await json(detailPath, member);
    assert.equal(detail.assessments.length, 1);
    assert.equal(detail.progress.learningStatus, 'submitted');
    await json(applyPath, member, { ...submission, note: 'changed' }, 409);
    assert.equal(
      (await json(`${detailPath}?userId=${a.id}`, other)).assessments.length,
      0,
      'member history is always owned by session',
    );
    await json(`/api/member/members/${a.id}/quests/main-001/learning`, other, undefined, 404);
    const rejected = {
      ...baseReview,
      requestId: randomUUID(),
      expectedVersion: detail.progress.version,
      expectedAttemptId: detail.assessments[0].id,
      decision: 'needs_revision',
      feedback: '测试修改意见',
    };
    await json(reviewPath, admin, { ...rejected, expectedAttemptId: randomUUID() }, 409);
    await json(reviewPath, admin, rejected);
    await json(reviewPath, admin, rejected);
    const firstHistory = await db.prepare('SELECT * FROM assessment_review').all();
    detail = await json(detailPath, member);
    assert.equal(detail.progress.learningStatus, 'needs_revision');
    assert.equal(detail.assessments[0].review.feedback, '测试修改意见');
    assert.equal((await json(detailPath, other)).assessments.length, 0);
    const retry = {
      requestId: randomUUID(),
      expectedVersion: detail.progress.version,
      note: '重交备注测试',
    };
    await json(applyPath, member, retry);
    detail = await json(detailPath, member);
    assert.equal(detail.assessments.length, 2);
    const pending = detail.assessments.find((item) => item.state === 'pending');
    const passed = {
      ...baseReview,
      requestId: randomUUID(),
      expectedVersion: detail.progress.version,
      expectedAttemptId: pending.id,
    };
    const races = await Promise.all([
      request(reviewPath, admin, passed),
      request(reviewPath, admin, {
        ...passed,
        requestId: randomUUID(),
        decision: 'needs_revision',
        feedback: '竞争的不同结果',
      }),
    ]);
    assert.deepEqual(races.map((r) => r.status).sort(), [200, 409]);
    // Either decision can win; complete a fresh attempt if the rejection won the race.
    detail = await json(detailPath, member);
    let winningPass = passed;
    if (detail.progress.learningStatus !== 'passed') {
      await json(applyPath, member, {
        requestId: randomUUID(),
        expectedVersion: detail.progress.version,
        note: '',
      });
      detail = await json(detailPath, member);
      winningPass = {
        ...passed,
        requestId: randomUUID(),
        expectedVersion: detail.progress.version,
        expectedAttemptId: detail.assessments.find((item) => item.state === 'pending').id,
      };
      await json(reviewPath, admin, winningPass);
    }
    await json(reviewPath, admin, winningPass);
    await json(reviewPath, admin, { ...winningPass, feedback: 'changed' }, 409);
    detail = await json(detailPath, member);
    assert.equal(detail.progress.learningStatus, 'passed');
    assert.equal(detail.progress.rewardStatus, 'pending');
    assert.equal(detail.reward.label, '集成测试奖励甲');
    const crossChapter = await json('/api/member/quest-map', member);
    assert.equal(
      crossChapter.progress.find((item) => item.questId === 'task-second').unlocked,
      true,
      'a pass in another chapter unlocks while its reward remains unclaimed',
    );
    await json('/api/member/quests/task-second/start', other, {}, 409);
    await json('/api/member/quests/task-second/start', member, {});
    const originalProgress = await db
      .prepare('SELECT * FROM progress WHERE user_id=? AND quest_id=?')
      .bind(a.id, 'main-001')
      .first();
    const historyBeforePresentation = await db.prepare('SELECT * FROM assessment_review').all();
    const rewardsBeforePresentation = await db.prepare('SELECT * FROM reward_grant').all();
    await db
      .prepare("UPDATE chapter SET presentation=? WHERE id='second'")
      .bind(JSON.stringify({ ...presentation, viewport: { x: 10, y: 20, zoom: 1.2 } }))
      .run();
    await db.prepare("UPDATE chapter SET title='第二章改名',sort_order=3 WHERE id='second'").run();
    const reordered = await json('/api/member/quest-map', member);
    assert.deepEqual(
      reordered.map.chapters.map((item) => item.id),
      ['chapter-001', 'empty', 'second'],
    );
    assert.deepEqual(
      await db
        .prepare('SELECT * FROM progress WHERE user_id=? AND quest_id=?')
        .bind(a.id, 'main-001')
        .first(),
      originalProgress,
    );
    assert.deepEqual(
      (await db.prepare('SELECT * FROM assessment_review').all()).results,
      historyBeforePresentation.results,
    );
    assert.deepEqual(
      (await db.prepare('SELECT * FROM reward_grant').all()).results,
      rewardsBeforePresentation.results,
    );
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM reward_grant').first()).n, 1);
    assert.deepEqual(
      (
        await db
          .prepare('SELECT * FROM assessment_review WHERE id=?')
          .bind(firstHistory.results[0].id)
          .all()
      ).results,
      firstHistory.results,
      'old review is never overwritten',
    );
    await json('/api/member/quests/main-002/start', member, {});
    assert.equal(
      (await json('/api/member/quest-map', member)).progress.find(
        (item) => item.questId === 'main-002',
      ).learningStatus,
      'in_progress',
      'unclaimed reward does not block next task',
    );
    await json(settingPath, admin, { expectedVersion: 1, label: '集成测试奖励乙' });
    assert.equal(
      (await json(detailPath, member)).reward.label,
      '集成测试奖励甲',
      'grant keeps pass-time snapshot',
    );
    const noRewardReview = { ...baseReview, requestId: randomUUID() };
    await json(`/api/admin/learning/members/${a.id}/quests/main-002/review`, admin, noRewardReview);
    const noReward = await json('/api/member/quests/main-002/learning', member);
    assert.equal(noReward.progress.rewardStatus, 'not_applicable');
    assert.equal(noReward.reward, null);
    assert.equal(
      noReward.assessments[0].requestedByName,
      '测试管理员',
      'direct offline registration is attributable',
    );

    // A failure in the last statement rolls back progress, attempt, review and grant together.
    await db.prepare("DELETE FROM throttle WHERE key LIKE 'admin:%'").run();
    await json('/api/member/quests/main-001/start', other, {});
    await db.exec(
      "CREATE TRIGGER fail_learning_audit BEFORE INSERT ON audit_event WHEN NEW.action='offline_passed' BEGIN SELECT RAISE(ABORT,'test rollback'); END",
    );
    const otherReviewPath = `/api/admin/learning/members/${b.id}/quests/main-001/review`;
    await json(otherReviewPath, admin, { ...baseReview, requestId: randomUUID() }, 500);
    const rolledBack = await json(detailPath, other);
    assert.equal(rolledBack.progress.learningStatus, 'in_progress');
    assert.equal(rolledBack.progress.version, 0);
    assert.equal(rolledBack.assessments.length, 0);
    assert.equal(rolledBack.reward, null);
    await db.exec('DROP TRIGGER fail_learning_audit');
    await json(otherReviewPath, admin, { ...baseReview, requestId: randomUUID() });
    const otherGrant = (await json(detailPath, other)).reward;
    assert.equal(otherGrant.label, '集成测试奖励乙');
    const deliveryPath = `/api/admin/learning/rewards/${detail.reward.id}/deliver`;
    const delivery = { requestId: randomUUID(), note: '集成测试交付备注' };
    await json(deliveryPath, member, delivery, 403);
    await json(deliveryPath, null, delivery, 401);
    await json('/api/member/quests/main-001/reward', member, delivery, 404);
    const deliveryRaces = await Promise.all([
      request(deliveryPath, admin, delivery),
      request(deliveryPath, admin, { ...delivery, requestId: randomUUID() }),
    ]);
    assert.deepEqual(deliveryRaces.map((r) => r.status).sort(), [200, 409]);
    const appliedDelivery = await db
      .prepare('SELECT delivery_key,delivered_by,delivered_at FROM reward_grant WHERE id=?')
      .bind(detail.reward.id)
      .first();
    const winningDelivery = {
      ...delivery,
      requestId: appliedDelivery.delivery_key.split(':').at(-1),
    };
    await json(deliveryPath, admin, winningDelivery);
    await json(deliveryPath, admin, { ...winningDelivery, note: 'changed' }, 409);
    await json(`/api/admin/learning/rewards/${otherGrant.id}/deliver`, admin, winningDelivery, 409);
    assert.equal(appliedDelivery.delivered_by, adminId);
    assert.ok(appliedDelivery.delivered_at > 0);
    assert.equal(
      (
        await db
          .prepare("SELECT COUNT(*) n FROM audit_event WHERE action='reward_delivered'")
          .first()
      ).n,
      1,
    );
    assert.equal((await json(detailPath, member)).progress.rewardStatus, 'delivered');
    assert.equal((await db.prepare('PRAGMA foreign_key_check').all()).results.length, 0);
    await mf.dispose();
    mf = worker();
    db = await mf.getD1Database('DB');
    detail = await json(detailPath, member);
    assert.equal(detail.progress.learningStatus, 'passed');
    assert.equal(detail.reward.status, 'delivered');
    assert.equal(detail.reward.deliveredByName, '测试管理员');
    assert.equal(detail.reward.deliveryNote, delivery.note);
    assert.ok(detail.assessments.length >= 2, 'history survives runtime restart');
    assert.equal(
      (await json('/api/member/quest-map', member)).progress.find(
        (item) => item.questId === 'task-second',
      ).learningStatus,
      'in_progress',
    );
    // Invalid cross-chapter references fail closed rather than leaking drafts or serving half a graph.
    const definition = (
      await db.prepare("SELECT definition FROM quest WHERE id='task-second'").first()
    ).definition;
    const invalid = JSON.parse(definition);
    await db
      .prepare("UPDATE quest SET definition=? WHERE id='task-second'")
      .bind(
        JSON.stringify({
          ...invalid,
          content: [{ type: 'html', html: '<script>alert(1)</script>' }],
        }),
      )
      .run();
    await json('/api/member/quest-map', member, undefined, 500);
    for (const prerequisites of [['task-draft'], ['task-second'], ['missing']]) {
      await db
        .prepare("UPDATE quest SET definition=? WHERE id='task-second'")
        .bind(JSON.stringify({ ...invalid, prerequisites }))
        .run();
      await json('/api/member/quest-map', member, undefined, 500);
    }
    await db.prepare("UPDATE quest SET definition=? WHERE id='task-second'").bind(definition).run();
    await db.prepare("UPDATE chapter SET status='archived' WHERE id='second'").run();
    const archivedCourse = await json('/api/member/quest-map', member);
    assert.ok(!archivedCourse.map.chapters.some((item) => item.id === 'second'));
    assert.ok(!archivedCourse.map.quests.some((item) => item.id === 'task-second'));
    await json('/api/member/quests/task-second/start', member, {}, 404);
    assert.equal(
      (
        await db
          .prepare(
            "SELECT learning_status FROM progress WHERE user_id=? AND quest_id='task-second'",
          )
          .bind(a.id)
          .first()
      ).learning_status,
      'in_progress',
    );
    await db.prepare("UPDATE chapter SET status='archived'").run();
    assert.deepEqual((await json('/api/member/quest-map')).map, {
      mode: 'placeholder',
      revision: 0,
      chapters: [],
      quests: [],
      assets: [],
    });
  },
);
