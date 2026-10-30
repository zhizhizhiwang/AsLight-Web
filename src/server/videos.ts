import { Hono } from 'hono';
import { z } from 'zod';
import { assertAuthConfig, currentUser } from './auth.ts';
import { AccessError } from './access.ts';
import { consumeLimit } from './security.ts';
import { loadMap, ownProgress } from './course.ts';
import { b2Config, b2Enabled, signedObject, purgeObject } from './b2.ts';
import { createVideoInput, STORAGE_STOP_BYTES } from '../shared/videos.ts';
import { cachedVideo, evictVideo } from './video-cache.ts';
import { scanStorage, storageSummary, refreshStorageAlerts } from './storage-monitor.ts';
import type { Bindings } from './bindings.ts';
import type { AdminContext } from './admin-context.ts';

interface Video {
  id: string;
  user_id: string;
  quest_id: string;
  attempt_id: string | null;
  object_key: string;
  object_version: string | null;
  size: number;
  mime_type: string;
  status: 'uploading' | 'ready' | 'deleting' | 'delete_failed' | 'deleted';
  created_at: number;
  expires_at: number;
}
async function getVideo(env: Bindings, id: string) {
  const video = await env.DB.prepare('SELECT * FROM video WHERE id=?').bind(id).first<Video>();
  if (!video) throw new AccessError('NOT_FOUND', '视频不存在。', 404);
  return video;
}
export async function listVideos(env: Bindings, userId: string, questId: string) {
  const rows = await env.DB.prepare(
    'SELECT * FROM video WHERE user_id=? AND quest_id=? ORDER BY created_at DESC LIMIT 100',
  )
    .bind(userId, questId)
    .all<Video>();
  return {
    enabled: b2Enabled(env),
    videos: rows.results.map((v) => ({
      id: v.id,
      userId: v.user_id,
      questId: v.quest_id,
      attemptId: v.attempt_id,
      size: v.size,
      status: v.status,
      createdAt: v.created_at,
    })),
  };
}
export const videos = new Hono<{ Bindings: Bindings; Variables: { owner: string } }>()
  .use('*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store');
    assertAuthConfig(c.env, c.req.raw);
    if (c.req.method !== 'GET' && c.req.header('Origin') !== c.env.APP_ORIGIN)
      throw new AccessError('INVALID_ORIGIN', '请求来源不受信任。', 403);
    const user = await currentUser(c.env, c.req.raw.headers);
    if (!user) throw new AccessError('NOT_SIGNED_IN', '请先登录。', 401);
    c.set('owner', user.id);
    if (
      c.req.method !== 'GET' &&
      !(await consumeLimit(c.env, `video:${user.id}`, { window: 60, max: 12 })).allowed
    )
      throw new AccessError('TOO_MANY_REQUESTS', '操作过于频繁。', 429);
    await next();
  })
  .get('/', async (c) =>
    c.json(await listVideos(c.env, c.get('owner'), c.req.query('questId') ?? '')),
  )
  .post('/', async (c) => {
    b2Config(c.env);
    const parsed = createVideoInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      throw new AccessError('INVALID_INPUT', '请选择不超过 100 MiB 的视频。', 400);
    const input = parsed.data,
      owner = c.get('owner'),
      now = Date.now();
    const map = await loadMap(c.env);
    const state = (await ownProgress(c.env, owner, map)).find((p) => p.questId === input.questId);
    if (!state?.unlocked || !['in_progress', 'needs_revision'].includes(state.learningStatus))
      throw new AccessError('STALE_STATE', '请先开始已解锁任务，或等待当前考核完成。', 409);
    let storage = await storageSummary(c.env);
    if (storage.stale) {
      await scanStorage(c.env);
      storage = await storageSummary(c.env);
    }
    if (storage.stale || storage.error || !storage.actual)
      throw new AccessError(
        'STORAGE_UNAVAILABLE',
        '正在核对视频容量，请稍后重试或联系管理员。',
        503,
      );
    const actual = storage.actual;
    const id = crypto.randomUUID(),
      key = `videos/${owner}/${id}`;
    const expiresAt = now + 300_000;
    const signed = await signedObject(c.env, key, 'PUT', {
      headers: {
        'Content-Type': input.mimeType,
        'Content-Length': String(input.size),
        'x-amz-meta-video-id': id,
      },
    });
    const result = await c.env.DB.prepare(
      `INSERT INTO video (id,user_id,quest_id,object_key,size,mime_type,created_at,expires_at)
      SELECT ?,?,?,?,?,?,?,? WHERE
      MAX((SELECT COALESCE(SUM(size),0) FROM video WHERE status!='deleted'),
        ?+(SELECT COALESCE(SUM(size),0) FROM video WHERE status!='deleted' AND (created_at>=? OR uploaded_at>=? OR status='uploading')))+?<=?
      AND EXISTS(SELECT 1 FROM storage_monitor WHERE id='b2' AND json_extract(snapshot,'$.completedAt')=? AND error IS NULL)
      AND (SELECT COUNT(*) FROM video WHERE user_id=? AND attempt_id IS NULL AND status IN ('uploading','ready'))<3
      AND EXISTS(SELECT 1 FROM progress WHERE user_id=? AND quest_id=? AND version=? AND learning_status IN ('in_progress','needs_revision'))
      AND EXISTS(SELECT 1 FROM course_revision WHERE id='current' AND revision=?)`,
    )
      .bind(
        id,
        owner,
        input.questId,
        key,
        input.size,
        input.mimeType,
        now,
        expiresAt,
        actual.currentBytes + actual.historicalBytes + actual.unfinishedBytes,
        actual.startedAt,
        actual.startedAt,
        input.size,
        STORAGE_STOP_BYTES,
        actual.completedAt,
        owner,
        owner,
        input.questId,
        state.version,
        map.revision,
      )
      .run();
    if (result.meta.changes !== 1)
      throw new AccessError(
        'UPLOAD_LIMIT',
        '暂时无法申请上传，请清理未提交视频或联系管理员检查容量。',
        409,
      );
    return c.json(
      {
        id,
        url: signed.url,
        expiresAt,
        headers: { 'Content-Type': input.mimeType, 'x-amz-meta-video-id': id },
      },
      201,
    );
  })
  .post('/:id/complete', async (c) => {
    const empty = z.strictObject({}).safeParse(await c.req.json().catch(() => null));
    if (!empty.success) throw new AccessError('INVALID_INPUT', '请求内容无效。', 400);
    const v = await getVideo(c.env, c.req.param('id'));
    if (v.user_id !== c.get('owner')) throw new AccessError('NOT_FOUND', '视频不存在。', 404);
    if (v.status === 'ready') return c.json({ id: v.id });
    if (v.status !== 'uploading' || Date.now() - v.created_at > 86_400_000)
      throw new AccessError('STALE_STATE', '上传已过期，请重新上传。', 409);
    const head = await fetch(await signedObject(c.env, v.object_key, 'HEAD'), {
      redirect: 'manual',
    });
    const version = head.headers.get('x-amz-version-id');
    if (
      !head.ok ||
      !version ||
      Number(head.headers.get('Content-Length')) !== v.size ||
      head.headers.get('Content-Type') !== v.mime_type ||
      head.headers.get('x-amz-meta-video-id') !== v.id
    )
      throw new AccessError('INVALID_VIDEO', '文件尚未上传完成，或文件属性不符。', 409);
    const probe = await fetch(
      await signedObject(c.env, v.object_key, 'GET', {
        version,
        headers: { Range: 'bytes=0-15' },
      }),
      { redirect: 'manual' },
    );
    const reader = probe.body?.getReader();
    let signature = new Uint8Array(0);
    try {
      if (probe.status !== 206 || !reader) throw new Error('Missing video header.');
      while (signature.length < 16) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const next = new Uint8Array(Math.min(16, signature.length + chunk.value.length));
        next.set(signature);
        next.set(chunk.value.subarray(0, next.length - signature.length), signature.length);
        signature = next;
      }
    } finally {
      await reader?.cancel();
    }
    const brand = new TextDecoder().decode(signature.subarray(4, 8));
    const valid =
      v.mime_type === 'video/webm'
        ? [0x1a, 0x45, 0xdf, 0xa3].every((byte, index) => signature[index] === byte)
        : signature.length >= 8 &&
          (brand === 'ftyp' ||
            (v.mime_type === 'video/quicktime' && ['moov', 'mdat', 'wide'].includes(brand)));
    if (!valid) throw new AccessError('INVALID_VIDEO', '无法识别视频文件，请使用 MP4 视频。', 400);
    const result = await c.env.DB.prepare(
      `UPDATE video SET status='ready',object_version=?,uploaded_at=?
      WHERE id=? AND user_id=? AND status='uploading'`,
    )
      .bind(version, Date.now(), v.id, c.get('owner'))
      .run();
    if (!result.meta.changes && (await getVideo(c.env, v.id)).status !== 'ready')
      throw new AccessError('STALE_STATE', '视频状态已变化。', 409);
    return c.json({ id: v.id });
  });

export async function deleteVideo(env: Bindings, id: string, actor: string, reason: string) {
  const now = Date.now();
  const v = await getVideo(env, id);
  if (['deleting', 'delete_failed', 'deleted'].includes(v.status)) return;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO audit_event(id,actor_id,target_id,action,reason,created_at)
      SELECT ?,?,user_id,'video_delete_requested',?,? FROM video WHERE id=? AND status IN ('uploading','ready')`,
    ).bind(crypto.randomUUID(), actor, `视频 ${id}：${reason}`, now, id),
    env.DB.prepare(
      `UPDATE video SET status='deleting',delete_requested_at=?,deleted_by=?,delete_reason=?
      WHERE id=? AND status IN ('uploading','ready')`,
    ).bind(now, actor, reason, id),
  ]);
  if (v.object_version)
    await evictVideo(env, { ...v, object_version: v.object_version }).catch(() => undefined);
}
export async function cleanupVideos(env: Bindings, fetcher: typeof fetch = fetch) {
  if (!b2Enabled(env)) return;
  const now = Date.now();
  await env.DB.prepare(
    `UPDATE video SET status='deleting',delete_requested_at=?,delete_reason='expired_upload'
    WHERE attempt_id IS NULL AND status IN ('uploading','ready') AND created_at<?`,
  )
    .bind(now, now - 86_400_000)
    .run();
  // Wait beyond the last upload URL; re-sweep tombstones for late in-flight PUTs.
  const v = await env.DB.prepare(
    `SELECT * FROM video WHERE expires_at<? AND
    (status IN ('deleting','delete_failed') OR (status='deleted' AND deleted_at>?))
    ORDER BY CASE WHEN status='deleted' THEN 1 ELSE 0 END,COALESCE(last_cleanup_at,0),id LIMIT 1`,
  )
    .bind(now - 900_000, now - 7 * 86_400_000)
    .first<Video>();
  if (!v) return;
  try {
    if (!(await purgeObject(env, v.object_key, fetcher))) throw new Error('More versions remain.');
    await env.DB.prepare(
      `UPDATE video SET status='deleted',deleted_at=COALESCE(deleted_at,?),last_cleanup_at=? WHERE id=? AND status IN ('deleting','delete_failed','deleted')`,
    )
      .bind(now, now, v.id)
      .run();
  } catch {
    await env.DB.prepare(
      `UPDATE video SET status='delete_failed',last_cleanup_at=? WHERE id=? AND status IN ('deleting','delete_failed','deleted')`,
    )
      .bind(now, v.id)
      .run();
  }
}
export const videoAdmin = new Hono<AdminContext>()
  .get('/members/:id/quests/:questId', async (c) =>
    c.json(await listVideos(c.env, c.req.param('id'), c.req.param('questId'))),
  )
  .get('/storage', async (c) => {
    await refreshStorageAlerts(c.env);
    return c.json(await storageSummary(c.env));
  })
  .post('/storage/refresh', async (c) => {
    if (!z.strictObject({}).safeParse(await c.req.json().catch(() => null)).success)
      throw new AccessError('INVALID_INPUT', '请求内容无效。', 400);
    if (!(await consumeLimit(c.env, 'b2:scan', { window: 60, max: 2 })).allowed)
      throw new AccessError('TOO_MANY_REQUESTS', '请稍后再同步。', 429);
    await scanStorage(c.env, true);
    await refreshStorageAlerts(c.env);
    return c.json(await storageSummary(c.env));
  })
  .get('/:id/stream', async (c) => {
    const v = await getVideo(c.env, c.req.param('id'));
    if (v.status !== 'ready' || !v.attempt_id || !v.object_version)
      throw new AccessError('NOT_FOUND', '视频已删除或尚未提交。', 404);
    return cachedVideo(
      c.env,
      { ...v, object_version: v.object_version },
      c.req.header('Range'),
      c.executionCtx,
    );
  })
  .post('/:id/delete', async (c) => {
    const parsed = z
      .strictObject({ reason: z.string().trim().min(1).max(300) })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AccessError('INVALID_INPUT', '请填写删除原因。', 400);
    await deleteVideo(c.env, c.req.param('id'), c.get('actor').id, parsed.data.reason);
    return c.json({ success: true });
  });
