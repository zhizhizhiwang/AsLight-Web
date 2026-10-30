import { signedObject } from './b2.ts';
import { AccessError } from './access.ts';
import type { Bindings } from './bindings.ts';

// Independent immutable 200 responses avoid Cache API's prohibition on storing 206.
export const VIDEO_CHUNK_BYTES = 16 * 1024 * 1024;
const TTL = 7 * 86400;
interface CachedVideo {
  id: string;
  object_key: string;
  object_version: string;
  size: number;
  mime_type: string;
}
function key(env: Bindings, v: CachedVideo, chunk: number) {
  return `${env.APP_ORIGIN}/api/_video-cache/${v.id}/${encodeURIComponent(v.object_version)}/${chunk}`;
}
async function ready(env: Bindings, id: string) {
  const row = await env.DB.prepare(
    "SELECT id FROM video WHERE id=? AND status='ready' AND attempt_id IS NOT NULL",
  )
    .bind(id)
    .first();
  if (!row) throw new AccessError('NOT_FOUND', '视频已停止播放。', 404);
}
export function videoRange(range: string | undefined, size: number) {
  if (!range) return { start: 0, end: size - 1 };
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) return null;
  const a = Number(match[1]),
    b = Number(match[2]);
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) return null;
  const start = match[1] ? a : Math.max(0, size - b);
  const end = match[1] ? (match[2] ? Math.min(b, size - 1) : size - 1) : size - 1;
  return start <= end && start < size ? { start, end } : null;
}
export async function cachedVideo(
  env: Bindings,
  v: CachedVideo,
  range: string | undefined,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
) {
  const selection = videoRange(range, v.size);
  if (!selection)
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${v.size}`, 'Cache-Control': 'private, no-store' },
    });
  const cache = await caches.open('aslight-video-v1');
  async function chunk(index: number) {
    await ready(env, v.id);
    const url = key(env, v, index);
    const start = index * VIDEO_CHUNK_BYTES,
      end = Math.min(v.size - 1, start + VIDEO_CHUNK_BYTES - 1);
    let hit: Response | undefined;
    try {
      hit = await cache.match(url);
    } catch {
      /* A cache outage must not prevent origin playback. */
    }
    if (hit) {
      const data = new Uint8Array(await hit.arrayBuffer());
      if (data.length === end - start + 1) {
        await ready(env, v.id);
        return data;
      }
      ctx.waitUntil(cache.delete(url).catch(() => false));
    }
    const response = await fetch(
      await signedObject(env, v.object_key, 'GET', {
        version: v.object_version,
        headers: { Range: `bytes=${start}-${end}` },
      }),
      { redirect: 'manual', signal: AbortSignal.timeout(30000) },
    );
    if (
      response.status !== 206 ||
      response.headers.get('Content-Range') !== `bytes ${start}-${end}/${v.size}`
    ) {
      await response.body?.cancel();
      throw new AccessError('STORAGE_UNAVAILABLE', '视频暂时无法播放。', 503);
    }
    // Bound memory even if an origin ignores its own range/length headers.
    const reader = response.body?.getReader();
    if (!reader) throw new AccessError('STORAGE_UNAVAILABLE', '视频暂时无法播放。', 503);
    const data = new Uint8Array(end - start + 1);
    let offset = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        if (offset + part.value.length > data.length) throw new Error('Oversized video chunk.');
        data.set(part.value, offset);
        offset += part.value.length;
      }
    } finally {
      await reader.cancel();
    }
    if (offset !== data.length)
      throw new AccessError('STORAGE_UNAVAILABLE', '视频暂时无法播放。', 503);
    await ready(env, v.id);
    ctx.waitUntil(
      (async () => {
        try {
          await cache.put(
            url,
            new Response(data, {
              headers: {
                'Content-Length': String(data.length),
                'Cache-Control': `public, max-age=${TTL}, immutable`,
              },
            }),
          );
          // A fill that races a delete must not leave an accessible entry locally.
          try {
            await ready(env, v.id);
          } catch {
            await cache.delete(url);
          }
        } catch {
          console.warn(JSON.stringify({ event: 'video_cache_write_failed' }));
        }
      })(),
    );
    return data;
  }
  let index = Math.floor(selection.start / VIDEO_CHUNK_BYTES);
  let first: Uint8Array | null = await chunk(index);
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const bytes = first ?? (await chunk(index));
        first = null;
        const base = index * VIDEO_CHUNK_BYTES;
        controller.enqueue(
          bytes.subarray(
            Math.max(0, selection.start - base),
            Math.min(bytes.length, selection.end - base + 1),
          ),
        );
        index++;
        if (index * VIDEO_CHUNK_BYTES > selection.end) controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return new Response(stream, {
    status: range ? 206 : 200,
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Type': v.mime_type,
      'Content-Length': String(selection.end - selection.start + 1),
      ...(range ? { 'Content-Range': `bytes ${selection.start}-${selection.end}/${v.size}` } : {}),
      'Accept-Ranges': 'bytes',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
export async function evictVideo(env: Bindings, v: CachedVideo) {
  const cache = await caches.open('aslight-video-v1');
  await Promise.all(
    Array.from({ length: Math.ceil(v.size / VIDEO_CHUNK_BYTES) }, (_, i) =>
      cache.delete(key(env, v, i)),
    ),
  );
}
