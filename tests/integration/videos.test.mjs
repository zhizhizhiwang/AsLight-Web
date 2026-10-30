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
    let failScan = false,
      pageSize = 1000,
      monitorPrefix = 'videos/';
    let unfinished = [];
    let partPages = [];
    let authorizationGate, onAuthorize;
    const calls = [];
    const outbound = async (request) => {
      const url = new URL(request.url);
      calls.push({ method: request.method, url, headers: request.headers });
      if (url.hostname === 'api.backblazeb2.com') {
        onAuthorize?.();
        if (authorizationGate) await authorizationGate;
        return Response.json({
          authorizationToken: 'test-token',
          apiInfo: {
            storageApi: {
              apiUrl: 'https://api001.backblazeb2.com',
              allowed: { namePrefix: monitorPrefix },
            },
          },
        });
      }
      if (url.hostname === 'api001.backblazeb2.com') {
        const body = await request.json();
        if (failScan && url.pathname.includes('b2_list_')) return new Response('', { status: 503 });
        if (url.pathname.endsWith('b2_list_file_versions')) {
          const files = [...objects]
            .filter(([key]) => key.startsWith(body.prefix))
            .sort(([a], [b]) => a.localeCompare(b))
            .flatMap(([key, object]) =>
              object.versions.map((fileId) => ({
                fileId,
                fileName: key,
                contentLength: fileId.startsWith('hide') ? 0 : object.size,
                action: fileId.startsWith('hide') ? 'hide' : 'upload',
              })),
            );
          const start = body.startFileName
            ? files.findIndex(
                (f) => f.fileName === body.startFileName && f.fileId === body.startFileId,
              )
            : 0;
          const limit = Math.min(body.maxFileCount, pageSize);
          const next = files[start + limit];
          return Response.json({
            files: files.slice(start, start + limit),
            nextFileName: next?.fileName ?? null,
            nextFileId: next?.fileId ?? null,
          });
        }
        if (url.pathname.endsWith('b2_list_unfinished_large_files')) {
          assert.equal(body.namePrefix, monitorPrefix ?? '');
          const index = body.startFileId ? unfinished.indexOf(body.startFileId) : 0;
          return Response.json({
            files: unfinished.slice(index, index + 1).map((fileId) => ({ fileId })),
            nextFileId: unfinished[index + 1] ?? null,
          });
        }
        if (url.pathname.endsWith('b2_list_parts')) {
          const index = (body.startPartNumber ?? 1) - 1;
          return Response.json({
            parts: [{ contentLength: partPages[index] }],
            nextPartNumber: index + 1 < partPages.length ? index + 2 : null,
          });
        }
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
      const all = new Uint8Array(object.size).fill(
        url.searchParams.get('versionId') === 'v1' ? 65 : 66,
      );
      const bounds = range ? /^bytes=(\d+)-(\d+)$/.exec(range) : null;
      const start = bounds ? Number(bounds[1]) : 0,
        end = bounds ? Number(bounds[2]) : object.size - 1;
      return new Response(all.subarray(start, end + 1), {
        status: range ? 206 : 200,
        headers: {
          'Content-Length': String(end - start + 1),
          ...(range ? { 'Content-Range': 'bytes ' + start + '-' + end + '/' + object.size } : {}),
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
    assert.equal(await stream.text(), 'A'.repeat(11));
    assert.equal(calls.at(-1).url.searchParams.get('versionId'), 'v1');
    const originReads = () =>
      calls.filter((c) => c.method === 'GET' && c.url.hostname.startsWith('s3.')).length;
    const coldReads = originReads();
    for (const [range, length] of [
      ['bytes=991-', 9],
      ['bytes=-5', 5],
      [undefined, 1000],
    ]) {
      const warm = await mf.dispatchFetch(`${origin}/api/admin/videos/${ticket.id}/stream`, {
        headers: { Cookie: admin, ...(range ? { Range: range } : {}) },
      });
      assert.equal(warm.status, range ? 206 : 200);
      assert.equal(await warm.text(), 'A'.repeat(length));
    }
    assert.equal(originReads(), coldReads, 'warm full and range reads never connect to B2');
    await json(`/api/admin/videos/${ticket.id}/stream`, null, undefined, 401);
    await json(`/api/admin/videos/${ticket.id}/stream`, other, undefined, 403);
    await json(`/api/_video-cache/${ticket.id}/v1/0`, admin, undefined, 404);
    assert.equal(originReads(), coldReads, 'denied requests never consult B2');
    // A different version and a cross-chunk range cannot reuse old bytes.
    objects.get(videoKey).size = 16 * 1024 * 1024 + 17;
    await db
      .prepare('UPDATE video SET object_version=?,size=? WHERE id=?')
      .bind('v2', objects.get(videoKey).size, ticket.id)
      .run();
    for (let repeat = 0; repeat < 2; repeat++) {
      const boundary = await mf.dispatchFetch(`${origin}/api/admin/videos/${ticket.id}/stream`, {
        headers: { Cookie: admin, Range: 'bytes=16777214-16777219' },
      });
      assert.equal(boundary.status, 206);
      assert.equal(await boundary.text(), 'B'.repeat(6));
    }
    assert.equal(
      originReads(),
      coldReads + 2,
      'two chunks are fetched once and version keys are isolated',
    );
    objects.get(videoKey).size = 1000;
    await db
      .prepare('UPDATE video SET object_version=?,size=1000 WHERE id=?')
      .bind('v1', ticket.id)
      .run();
    assert.equal(
      (
        await mf.dispatchFetch(`${origin}/api/admin/videos/${ticket.id}/stream`, {
          headers: { Cookie: admin, Range: 'bytes=0-1,3-4' },
        })
      ).status,
      416,
    );
    for (const range of ['bytes=-0', 'bytes=1000-', 'bytes=20-10', 'bytes=9007199254740992-']) {
      const invalid = await mf.dispatchFetch(`${origin}/api/admin/videos/${ticket.id}/stream`, {
        headers: { Cookie: admin, Range: range },
      });
      assert.equal(invalid.status, 416);
      assert.equal(invalid.headers.get('Content-Range'), 'bytes */1000');
    }
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
    await json('/api/admin/videos/storage', other, undefined, 403);
    await json('/api/admin/videos/storage/refresh', other, {}, 403);
    assert.equal(
      (await request('/api/admin/videos/storage/refresh', admin, {}, 'https://untrusted.example'))
        .status,
      403,
    );
    // Actual storage includes objects that have no D1 reservation, old versions,
    // hidden files and uploaded parts. Force small pages to cross checkpoints.
    await db.prepare("UPDATE video SET status='deleted'").run();
    objects.clear();
    objects.set('videos/a-hidden', { size: 100, versions: ['hide-marker', 'old'] });
    objects.set('videos/b-live', { size: 200, versions: ['new', 'old2'] });
    objects.set('outside/not-visible', { size: 99999999, versions: ['outside'] });
    pageSize = 1;
    unfinished = ['u1', 'u2'];
    partPages = [10, 20];
    const refresh = async () => {
      await db.prepare('DELETE FROM throttle').run();
      return json('/api/admin/videos/storage/refresh', admin, {});
    };
    const partial = await refresh();
    assert.equal(partial.scanning, true);
    const checkpoint = await db
      .prepare("SELECT progress FROM storage_monitor WHERE id='b2'")
      .first();
    assert.ok(checkpoint.progress);
    let actualStats = await refresh();
    assert.equal(actualStats.scanning, false);
    assert.equal(actualStats.reservedBytes, 0);
    assert.equal(actualStats.actual.currentBytes, 200);
    assert.equal(actualStats.actual.historicalBytes, 300);
    assert.equal(actualStats.actual.unfinishedBytes, 60);
    assert.equal(actualStats.actual.unfinishedFiles, 2);
    assert.equal(actualStats.effectiveBytes, 560);
    assert.equal(actualStats.actual.prefix, 'videos/');
    const known = actualStats.actual;
    failScan = true;
    actualStats = await refresh();
    assert.deepEqual(actualStats.actual, known, 'failed scans preserve last complete totals');
    assert.ok(actualStats.error);
    assert.ok(actualStats.alerts.some((a) => a.kind === 'sync' && a.resolvedAt === null));
    await json('/api/videos', member, createBody, 503);
    failScan = false;
    pageSize = 1000;
    unfinished = [];
    objects.clear();
    objects.set('videos/orphan', { size: 4000000000, versions: ['new', 'old'] });
    actualStats = await refresh();
    assert.equal(actualStats.effectiveBytes, 8000000000);
    assert.ok(actualStats.alerts.some((a) => a.kind === 'capacity' && a.resolvedAt === null));
    assert.ok(actualStats.alerts.some((a) => a.kind === 'sync' && a.resolvedAt !== null));
    const openCount = actualStats.alerts.filter((a) => a.resolvedAt === null).length;
    actualStats = await json('/api/admin/videos/storage', admin);
    assert.equal(
      actualStats.alerts.filter((a) => a.resolvedAt === null).length,
      openCount,
      'alerts do not duplicate on refresh',
    );
    objects.get('videos/orphan').size = 5000000000;
    actualStats = await refresh();
    assert.equal(actualStats.effectiveBytes, 10000000000);
    await json('/api/videos', member, createBody, 409);
    objects.clear();
    monitorPrefix = null;
    objects.set('outside/included', { size: 30, versions: ['new'] });
    actualStats = await refresh();
    assert.equal(actualStats.actual.prefix, null);
    assert.equal(actualStats.actual.currentBytes, 30);
    assert.ok(actualStats.alerts.some((a) => a.kind === 'scope' && a.resolvedAt !== null));
    assert.ok(actualStats.alerts.some((a) => a.kind === 'capacity' && a.resolvedAt !== null));
    await db
      .prepare(
        "UPDATE storage_monitor SET snapshot=json_set(snapshot,'$.startedAt',0,'$.completedAt',0),attempted_at=0 WHERE id='b2'",
      )
      .run();
    failScan = true;
    await json('/api/videos', member, createBody, 503);
    actualStats = await json('/api/admin/videos/storage', admin);
    assert.equal(actualStats.stale, true);
    assert.equal(actualStats.actual.currentBytes, 30, 'stale failures never claim an empty bucket');
    failScan = false;
    actualStats = await refresh();
    // Hold one real scan in flight. A concurrent manual trigger reads the old
    // snapshot and cannot acquire its lease or duplicate upstream calls.
    await db.prepare('DELETE FROM throttle').run();
    let releaseAuthorization;
    authorizationGate = new Promise((resolve) => {
      releaseAuthorization = resolve;
    });
    const entered = new Promise((resolve) => {
      onAuthorize = resolve;
    });
    const firstScan = request('/api/admin/videos/storage/refresh', admin, {});
    await entered;
    const authorizations = calls.filter((c) => c.url.hostname === 'api.backblazeb2.com').length;
    const secondScan = await request('/api/admin/videos/storage/refresh', admin, {});
    assert.equal(secondScan.status, 200);
    await secondScan.arrayBuffer();
    assert.equal(
      calls.filter((c) => c.url.hostname === 'api.backblazeb2.com').length,
      authorizations,
    );
    releaseAuthorization();
    authorizationGate = null;
    onAuthorize = null;
    const firstResult = await firstScan;
    assert.equal(firstResult.status, 200);
    actualStats = await firstResult.json();
    await mf.dispose();
    mf = worker();
    db = await mf.getD1Database('DB');
    assert.equal(
      (await db.prepare('SELECT status FROM video WHERE id=?').bind(ticket.id).first()).status,
      'deleted',
    );
    const persistedStats = await json('/api/admin/videos/storage', admin);
    assert.deepEqual(persistedStats.actual, actualStats.actual);
  },
);
