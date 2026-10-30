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
  'built Worker + D1: B2 uploads, version pinning, ownership, submission, deletion and scheduled retry',
  { timeout: 120000 },
  async (t) => {
    const persistence = await mkdtemp(path.join(tmpdir(), 'aslight-video-'));
    const assetModules = (await readdir('dist/aslight/assets'))
      .filter((name) => name.endsWith('.js'))
      .map((name) => ({ type: 'ESModule', path: path.resolve('dist/aslight/assets', name) }));
    const objects = new Map();
    let failDelete = false;
    const calls = [];
    const outbound = async (request) => {
      const url = new URL(request.url);
      calls.push({ method: request.method, url, headers: request.headers });
      if (url.hostname === 'api.backblazeb2.com')
        return Response.json({
          authorizationToken: 'test-token',
          apiInfo: { storageApi: { apiUrl: 'https://api001.backblazeb2.com' } },
        });
      if (url.hostname === 'api001.backblazeb2.com') {
        const body = await request.json();
        if (url.pathname.endsWith('b2_list_file_versions'))
          return Response.json({
            files: [...(objects.get(body.prefix)?.versions ?? [])].map((fileId) => ({
              fileId,
              fileName: body.prefix,
            })),
            nextFileName: null,
            nextFileId: null,
          });
        if (failDelete) return new Response('', { status: 503 });
        const object = objects.get(body.fileName);
        if (object) object.versions = object.versions.filter((v) => v !== body.fileId);
        return Response.json({ fileId: body.fileId, fileName: body.fileName });
      }
      assert.equal(url.hostname, 's3.us-west-004.backblazeb2.com');
      const key = url.pathname.split('/').slice(2).join('/');
      const object = objects.get(key);
      if (!object) return new Response(null, { status: 404 });
      if (request.method === 'HEAD')
        return new Response(null, {
          headers: {
            'Content-Length': String(object.size),
            'Content-Type': object.mime,
            'x-amz-meta-video-id': object.id,
            'x-amz-version-id': object.versions[0],
          },
        });
      assert.ok(
        object.versions.includes(url.searchParams.get('versionId')),
        'download must pin a known version',
      );
      const range = request.headers.get('Range');
      if (range === 'bytes=0-15')
        return new Response(
          new Uint8Array([0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0]),
          { status: 206, headers: { 'Content-Range': `bytes 0-15/${object.size}` } },
        );
      return new Response('video-bytes', {
        status: range ? 206 : 200,
        headers: {
          'Content-Length': '11',
          ...(range ? { 'Content-Range': `bytes 0-10/${object.size}` } : {}),
        },
      });
    };
    const bindings = {
      APP_ORIGIN: origin,
      B2_KEY_ID: 'test-key-id',
      B2_APPLICATION_KEY: 'test-only-secret',
      B2_BUCKET_ID: 'bucket-id',
      B2_BUCKET_NAME: 'test-bucket',
      B2_S3_ENDPOINT: 'https://s3.us-west-004.backblazeb2.com',
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
          outboundService: outbound,
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

    const questId = 'main-001';
    const createBody = { questId, size: 1000, mimeType: 'video/mp4' };
    assert.equal(
      (await request('/api/videos', member, createBody, 'https://untrusted.example')).status,
      403,
    );
    await json('/api/videos', null, createBody, 401);
    await json('/api/videos', member, createBody, 409);
    await json(`/api/member/quests/${questId}/start`, member, {});
    await json(`/api/member/quests/${questId}/start`, other, {});
    await json('/api/videos', member, { ...createBody, size: 104857601 }, 400);
    const ticket = await json('/api/videos', member, createBody, 201);
    const signed = new URL(ticket.url);
    assert.equal(signed.hostname, 's3.us-west-004.backblazeb2.com');
    assert.equal(signed.searchParams.get('X-Amz-Expires'), '300');
    assert.equal(
      signed.searchParams.get('X-Amz-SignedHeaders'),
      'content-length;content-type;host;x-amz-meta-video-id',
    );
    assert.equal(ticket.headers['Content-Type'], 'video/mp4');
    const row = await db.prepare('SELECT * FROM video WHERE id=?').bind(ticket.id).first();
    const videoKey = row.object_key;
    await json(`/api/videos/${ticket.id}/complete`, other, {}, 404);
    await json(`/api/videos/${ticket.id}/complete`, member, { objectKey: videoKey }, 400);
    await json(`/api/videos/${ticket.id}/complete`, member, {}, 409);
    objects.set(videoKey, { size: 999, mime: 'video/mp4', id: ticket.id, versions: ['v1'] });
    await json(`/api/videos/${ticket.id}/complete`, member, {}, 409);
    objects.get(videoKey).size = 1000;
    await json(`/api/videos/${ticket.id}/complete`, member, {});
    await json(`/api/videos/${ticket.id}/complete`, member, {});
    assert.equal(
      (await db.prepare('SELECT object_version FROM video WHERE id=?').bind(ticket.id).first())
        .object_version,
      'v1',
    );
    await json(`/api/admin/videos/${ticket.id}/stream`, member, undefined, 403);
    await json(`/api/admin/videos/${ticket.id}/stream`, admin, undefined, 404);
    const detail = await json(`/api/member/quests/${questId}/learning`, member);
    const input = {
      expectedVersion: detail.progress.version,
      requestId: randomUUID(),
      note: '',
      videoId: ticket.id,
    };
    const otherDetail = await json(`/api/member/quests/${questId}/learning`, other);
    await json(
      `/api/member/quests/${questId}/assessments`,
      other,
      { ...input, expectedVersion: otherDetail.progress.version },
      409,
    );
    await json(`/api/member/quests/${questId}/assessments`, member, input);
    await json(`/api/member/quests/${questId}/assessments`, member, input);
    const attempts = await db
      .prepare('SELECT * FROM assessment_attempt WHERE user_id=?')
      .bind(a.id)
      .all();
    assert.equal(attempts.results.length, 1);
    assert.equal(
      (await db.prepare('SELECT attempt_id FROM video WHERE id=?').bind(ticket.id).first())
        .attempt_id,
      attempts.results[0].id,
    );
    objects.get(videoKey).versions.unshift('v2');
    const stream = await mf.dispatchFetch(`${origin}/api/admin/videos/${ticket.id}/stream`, {
      headers: { Cookie: admin, Range: 'bytes=0-10' },
    });
    assert.equal(stream.status, 206);
    assert.equal(stream.headers.get('Content-Range'), 'bytes 0-10/1000');
    assert.equal(stream.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(await stream.text(), 'video-bytes');
    assert.equal(calls.at(-1).url.searchParams.get('versionId'), 'v1');
    assert.equal(
      (
        await mf.dispatchFetch(`${origin}/api/admin/videos/${ticket.id}/stream`, {
          headers: { Cookie: admin, Range: 'bytes=0-1,3-4' },
        })
      ).status,
      416,
    );
    const beforeReview = await json(`/api/member/quests/${questId}/learning`, member);
    await json(`/api/admin/learning/members/${a.id}/quests/${questId}/review`, admin, {
      requestId: randomUUID(),
      expectedVersion: beforeReview.progress.version,
      expectedAttemptId: attempts.results[0].id,
      decision: 'needs_revision',
      feedback: '需修改',
      assessedAt: Date.now(),
    });
    assert.equal(
      (await db.prepare('SELECT status FROM video WHERE id=?').bind(ticket.id).first()).status,
      'ready',
      'review never deletes video',
    );
    await db.prepare('UPDATE video SET created_at=0 WHERE id=?').bind(ticket.id).run();
    await (await mf.getWorker()).scheduled({ cron: '*/30 * * * *' });
    assert.equal(
      (await db.prepare('SELECT status FROM video WHERE id=?').bind(ticket.id).first()).status,
      'ready',
      'submitted videos never expire automatically',
    );
    await json(`/api/admin/videos/${ticket.id}/delete`, other, { reason: '越权' }, 403);
    await Promise.all([
      json(`/api/admin/videos/${ticket.id}/delete`, admin, { reason: '管理员确认删除' }),
      json(`/api/admin/videos/${ticket.id}/delete`, admin, { reason: '重复删除' }),
    ]);
    await json(`/api/admin/videos/${ticket.id}/stream`, admin, undefined, 404);
    assert.equal(
      (
        await db
          .prepare("SELECT COUNT(*) AS n FROM audit_event WHERE action='video_delete_requested'")
          .first()
      ).n,
      1,
    );
    await db.prepare('UPDATE video SET expires_at=0 WHERE id=?').bind(ticket.id).run();
    const scheduled = async () => {
      const worker = await mf.getWorker();
      await worker.scheduled({ cron: '*/30 * * * *' });
    };
    failDelete = true;
    await scheduled();
    assert.equal(
      (await db.prepare('SELECT status FROM video WHERE id=?').bind(ticket.id).first()).status,
      'delete_failed',
    );
    failDelete = false;
    await scheduled();
    assert.equal(
      (await db.prepare('SELECT status FROM video WHERE id=?').bind(ticket.id).first()).status,
      'deleted',
    );
    assert.deepEqual(objects.get(videoKey).versions, [], 'all object versions permanently deleted');
    const history = await json(`/api/member/quests/${questId}/learning`, member);
    assert.equal(history.assessments[0].review.feedback, '需修改');
    assert.equal(history.progress.learningStatus, 'needs_revision');
    // Abandoned uploads are cleaned, submitted files are never aged out.
    const abandoned = await json('/api/videos', other, createBody, 201);
    await db
      .prepare('UPDATE video SET created_at=0,expires_at=0 WHERE id=?')
      .bind(abandoned.id)
      .run();
    await scheduled();
    assert.equal(
      (await db.prepare('SELECT status FROM video WHERE id=?').bind(abandoned.id).first()).status,
      'deleted',
    );
    const stats = await json('/api/admin/videos/storage', admin);
    assert.equal(stats.reservedBytes, 0);
    const quota = await Promise.all(
      Array.from({ length: 4 }, () => request('/api/videos', other, createBody)),
    );
    assert.deepEqual(
      quota.map((r) => r.status).sort(),
      [201, 201, 201, 409],
      'per-user quota is atomic under concurrent reservations',
    );
    await Promise.all(quota.map((r) => r.arrayBuffer()));
    // Fill only metadata in this isolated D1; no real video bytes or cloud writes.
    await db.batch(
      Array.from({ length: 85 }, () => {
        const id = randomUUID();
        return db
          .prepare(
            "INSERT INTO video(id,user_id,quest_id,object_key,size,mime_type,status,created_at,expires_at) VALUES (?,?,?,? ,104857600,'video/mp4','ready',?,?)",
          )
          .bind(id, a.id, questId, `videos/${a.id}/${id}`, Date.now(), Date.now());
      }),
    );
    await json(`/api/member/quests/${questId}/start`, admin, {});
    const capacity = await Promise.all(
      Array.from({ length: 2 }, () =>
        request('/api/videos', admin, { ...createBody, size: 60 * 1024 * 1024 }),
      ),
    );
    assert.deepEqual(
      capacity.map((r) => r.status).sort(),
      [201, 409],
      'storage stop line is atomic under concurrent reservations',
    );
    await Promise.all(capacity.map((r) => r.arrayBuffer()));
    await mf.dispose();
    mf = worker();
    db = await mf.getD1Database('DB');
    assert.equal(
      (await db.prepare('SELECT status FROM video WHERE id=?').bind(ticket.id).first()).status,
      'deleted',
    );
  },
);
