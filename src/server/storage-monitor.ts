import { z } from 'zod';
import { b2Config, b2Enabled, nativeB2 } from './b2.ts';
import {
  storageSnapshotSchema,
  STORAGE_STOP_BYTES,
  STORAGE_WARNING_BYTES,
} from '../shared/videos.ts';
import type { Bindings } from './bindings.ts';

const HOUR = 3600000;
const progressSchema = storageSnapshotSchema.omit({ completedAt: true }).extend({
  phase: z.enum(['versions', 'unfinished', 'parts', 'done']),
  fileName: z.string().nullable(),
  fileId: z.string().nullable(),
  lastName: z.string().nullable(),
  partFile: z.string().nullable(),
  partNumber: z.number().nullable(),
});
const bytes = z.number().int().nonnegative().safe();
const versionsSchema = z.object({
  files: z.array(
    z.object({
      fileId: z.string(),
      fileName: z.string(),
      contentLength: bytes,
      action: z.enum(['upload', 'hide', 'start', 'folder']),
    }),
  ),
  nextFileName: z.string().nullable(),
  nextFileId: z.string().nullable(),
});
const unfinishedSchema = z.object({
  files: z.array(z.object({ fileId: z.string() })),
  nextFileId: z.string().nullable(),
});
const partsSchema = z.object({
  parts: z.array(z.object({ contentLength: bytes })),
  nextPartNumber: z.number().int().positive().nullable(),
});
interface Row {
  snapshot: string | null;
  progress: string | null;
  error: string | null;
  attempted_at: number;
}
async function row(env: Bindings) {
  return env.DB.prepare(
    "SELECT snapshot,progress,error,attempted_at FROM storage_monitor WHERE id='b2'",
  ).first<Row>();
}

// At most six listing calls per invocation. Checkpoints and a fenced lease make
// scheduled/manual overlap and large buckets safe without unbounded Worker work.
export async function scanStorage(env: Bindings, force = false, fetcher: typeof fetch = fetch) {
  if (!b2Enabled(env)) return;
  const now = Date.now();
  await env.DB.prepare("INSERT OR IGNORE INTO storage_monitor(id) VALUES('b2')").run();
  const before = await row(env);
  if (
    !force &&
    !before?.progress &&
    before?.snapshot &&
    now - storageSnapshotSchema.parse(JSON.parse(before.snapshot)).completedAt < 1500000 &&
    now - storageSnapshotSchema.parse(JSON.parse(before.snapshot)).startedAt < HOUR
  )
    return;
  const lease = crypto.randomUUID();
  const claimed = await env.DB.prepare(
    "UPDATE storage_monitor SET lease=?,lease_until=?,attempted_at=? WHERE id='b2' AND lease_until<? AND (? OR attempted_at<?)",
  )
    .bind(lease, now + 120000, now, now, force ? 1 : 0, now - 60000)
    .run();
  if (!claimed.meta.changes) return;
  const current = await row(env);
  try {
    if (!!env.B2_MONITOR_KEY_ID !== !!env.B2_MONITOR_APPLICATION_KEY)
      throw new Error('Incomplete monitor credentials.');
    const { call, prefix, scopeKnown } = await nativeB2(env, fetcher, true);
    if (!scopeKnown) throw new Error('Unknown key scope.');
    let progress = current?.progress ? progressSchema.parse(JSON.parse(current.progress)) : null;
    if (!progress || progress.prefix !== prefix || now - progress.startedAt > 24 * HOUR)
      progress = {
        startedAt: now,
        prefix,
        currentBytes: 0,
        historicalBytes: 0,
        unfinishedBytes: 0,
        versions: 0,
        unfinishedFiles: 0,
        phase: 'versions',
        fileName: null,
        fileId: null,
        lastName: null,
        partFile: null,
        partNumber: null,
      };
    const bucketId = b2Config(env).bucketId;
    async function api(name: string, body: unknown) {
      const response = await call(name, body);
      if (!response.ok) throw new Error('B2 listing unavailable.');
      return response.json();
    }
    for (let budget = 0; budget < 6 && progress.phase !== 'done'; budget++) {
      if (progress.phase === 'versions') {
        const page = versionsSchema.parse(
          await api('b2_list_file_versions', {
            bucketId,
            prefix: prefix ?? '',
            maxFileCount: 1000,
            ...(progress.fileName
              ? { startFileName: progress.fileName, startFileId: progress.fileId }
              : {}),
          }),
        );
        for (const file of page.files) {
          if (prefix && !file.fileName.startsWith(prefix)) throw new Error('Unexpected scope.');
          if (file.action === 'upload') {
            if (progress.lastName !== file.fileName) progress.currentBytes += file.contentLength;
            else progress.historicalBytes += file.contentLength;
            progress.versions++;
          }
          if (file.action === 'upload' || file.action === 'hide') progress.lastName = file.fileName;
        }
        progress.fileName = page.nextFileName;
        progress.fileId = page.nextFileId;
        if (!page.nextFileName) {
          progress.phase = 'unfinished';
          progress.fileId = null;
        }
      } else if (progress.phase === 'unfinished') {
        const page = unfinishedSchema.parse(
          await api('b2_list_unfinished_large_files', {
            bucketId,
            namePrefix: prefix ?? '',
            maxFileCount: 1,
            ...(progress.fileId ? { startFileId: progress.fileId } : {}),
          }),
        );
        progress.fileId = page.nextFileId;
        if (page.files[0]) {
          progress.partFile = page.files[0].fileId;
          progress.partNumber = null;
          progress.unfinishedFiles++;
          progress.phase = 'parts';
        } else progress.phase = page.nextFileId ? 'unfinished' : 'done';
      } else {
        const page = partsSchema.parse(
          await api('b2_list_parts', {
            fileId: progress.partFile,
            maxPartCount: 1000,
            ...(progress.partNumber ? { startPartNumber: progress.partNumber } : {}),
          }),
        );
        progress.unfinishedBytes += page.parts.reduce((sum, part) => sum + part.contentLength, 0);
        progress.partNumber = page.nextPartNumber;
        if (!page.nextPartNumber) progress.phase = progress.fileId ? 'unfinished' : 'done';
      }
    }
    const complete = progress.phase === 'done';
    const snapshot = complete
      ? JSON.stringify(storageSnapshotSchema.parse({ ...progress, completedAt: Date.now() }))
      : null;
    await env.DB.prepare(
      "UPDATE storage_monitor SET snapshot=COALESCE(?,snapshot),progress=?,error=NULL,lease=NULL,lease_until=0 WHERE id='b2' AND lease=?",
    )
      .bind(snapshot, complete ? null : JSON.stringify(progress), lease)
      .run();
  } catch {
    // Never replace a known total with zero on failed or partial scans. Restart a
    // failed scan, since objects may change while a checkpoint is unattended.
    await env.DB.prepare(
      "UPDATE storage_monitor SET progress=NULL,error=?,lease=NULL,lease_until=0 WHERE id='b2' AND lease=?",
    )
      .bind('B2 容量同步失败，请检查密钥权限或稍后重试。', lease)
      .run();
  }
}
export async function storageSummary(env: Bindings) {
  const state = await row(env);
  const actual = state?.snapshot ? storageSnapshotSchema.parse(JSON.parse(state.snapshot)) : null;
  const totals = await env.DB.prepare(
    `SELECT COALESCE(SUM(size),0) AS reservedBytes,COUNT(*) AS count,
    COALESCE(SUM(status='delete_failed'),0) AS failedDeletes,
    COALESCE(SUM(CASE WHEN created_at>=? OR uploaded_at>=? OR status='uploading' THEN size ELSE 0 END),0) AS pendingBytes
    FROM video WHERE status!='deleted'`,
  )
    .bind(actual?.startedAt ?? 0, actual?.startedAt ?? 0)
    .first<{ reservedBytes: number; count: number; failedDeletes: number; pendingBytes: number }>();
  const reservedBytes = totals?.reservedBytes ?? 0;
  const effectiveBytes = Math.max(
    reservedBytes,
    actual
      ? actual.currentBytes +
          actual.historicalBytes +
          actual.unfinishedBytes +
          (totals?.pendingBytes ?? 0)
      : reservedBytes,
  );
  const alerts = await env.DB.prepare(
    'SELECT kind,message,opened_at AS openedAt,resolved_at AS resolvedAt FROM storage_alert ORDER BY resolved_at IS NULL DESC,opened_at DESC LIMIT 30',
  ).all();
  return {
    reservedBytes,
    count: totals?.count ?? 0,
    failedDeletes: totals?.failedDeletes ?? 0,
    actual,
    effectiveBytes,
    warningBytes: STORAGE_WARNING_BYTES,
    stopBytes: STORAGE_STOP_BYTES,
    stale: !actual || Date.now() - actual.startedAt > HOUR,
    scanning: !!state?.progress,
    error: state?.error ?? null,
    alerts: alerts.results,
  };
}
export async function refreshStorageAlerts(env: Bindings) {
  if (!b2Enabled(env)) return;
  const summary = await storageSummary(env);
  const conditions: Record<string, string | null> = {
    capacity:
      summary.effectiveBytes >= STORAGE_STOP_BYTES
        ? '容量已达到 9 GB，新上传已暂停。'
        : summary.effectiveBytes >= STORAGE_WARNING_BYTES
          ? '容量已达到 7 GB，请及时清理视频。'
          : null,
    stale: summary.stale ? '容量统计尚未完成或已超过一小时，新上传暂缓。' : null,
    sync: summary.error,
    scope: summary.actual?.prefix
      ? `当前仅统计 ${summary.actual.prefix} 范围；桶内其他路径占用未知。`
      : null,
    deletion: summary.failedDeletes
      ? `${summary.failedDeletes} 个视频清理失败，系统会定时重试。`
      : null,
  };
  const entries = Object.entries(conditions);
  const now = Date.now();
  const result = await env.DB.batch(
    entries.flatMap(([kind, message]) => {
      // Resolve changed messages, then open the new state atomically and only log transitions.
      return [
        env.DB.prepare(
          'UPDATE storage_alert SET resolved_at=? WHERE kind=? AND resolved_at IS NULL AND message!=?',
        ).bind(now, kind, message ?? ''),
        env.DB.prepare(
          'INSERT OR IGNORE INTO storage_alert(id,kind,message,opened_at) SELECT ?,?,?,? WHERE ? IS NOT NULL',
        ).bind(crypto.randomUUID(), kind, message ?? '', now, message),
      ];
    }),
  );
  entries.forEach(([kind, message], index) => {
    if (result.slice(index * 2, index * 2 + 2).some((r) => r.meta.changes))
      console.warn(JSON.stringify({ event: 'storage_alert_changed', kind, active: !!message }));
  });
}
