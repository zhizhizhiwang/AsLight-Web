import { useEffect, useState } from 'react';
import { z } from 'zod';
import { storageSummarySchema } from '../shared/videos.ts';
import { requestJson } from './auth.ts';
import { Button, Panel } from './ui.tsx';

const gb = (value: number) => {
  if (!value) return '0 B';
  if (value < 1e6) return `${(value / 1000).toFixed(3)} KB`;
  if (value < 1e9) return `${(value / 1e6).toFixed(3)} MB`;
  return `${(value / 1e9).toFixed(3)} GB`;
};
export function StoragePanel() {
  const [summary, setSummary] = useState<z.infer<typeof storageSummarySchema> | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void requestJson('/api/admin/videos/storage', undefined, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setSummary(storageSummarySchema.parse(data));
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('容量信息加载失败，请重试。');
      });
    return () => controller.abort();
  }, []);
  const actual = summary?.actual;
  return (
    <Panel className="form-stack">
      <h2>视频存储与告警</h2>
      {error && <p role="alert">{error}</p>}
      {!summary && !error && <p role="status">正在读取容量信息…</p>}
      {summary && (
        <>
          <p>
            容量预警 {gb(summary.warningBytes)}，达到 {gb(summary.stopBytes)} 暂停新上传。
          </p>
          <progress
            style={{ width: '100%' }}
            aria-label="视频容量占用"
            value={Math.min(summary.effectiveBytes, summary.stopBytes)}
            max={summary.stopBytes}
          />
          <p>
            用于上传限额的占用：{gb(summary.effectiveBytes)} · 视频预留：{gb(summary.reservedBytes)}
            （{summary.count} 项）
          </p>
          {actual ? (
            <>
              <p>
                B2 实际占用：
                <strong>
                  {gb(actual.currentBytes + actual.historicalBytes + actual.unfinishedBytes)}
                </strong>
              </p>
              <p>
                当前文件 {gb(actual.currentBytes)} · 历史版本 {gb(actual.historicalBytes)} ·
                未完成上传 {gb(actual.unfinishedBytes)}（{actual.unfinishedFiles} 项）
              </p>
              <p style={{ overflowWrap: 'anywhere' }}>
                统计范围：{actual.prefix ? `仅 ${actual.prefix}` : '整个存储桶'} · {actual.versions}{' '}
                个文件版本
              </p>
              <p>
                最近完整同步：{new Date(actual.completedAt).toLocaleString('zh-CN')}。
                {summary.stale ? '统计已过期，新上传暂缓。' : '每半小时自动核对。'}
              </p>
            </>
          ) : (
            <p>尚无完整的 B2 容量统计，新上传将等待核对完成。</p>
          )}
          {summary.scanning && (
            <p role="status">分批核对中，可稍后继续同步；完成前保留上一次统计。</p>
          )}
          {summary.error && <p role="alert">{summary.error}</p>}
          <div role="status" aria-live="polite">
            <h3>当前告警</h3>
            {summary.alerts.some((a) => a.resolvedAt === null) ? (
              <ul>
                {summary.alerts
                  .filter((a) => a.resolvedAt === null)
                  .map((a) => (
                    <li key={a.kind}>
                      {a.message}（{new Date(a.openedAt).toLocaleString('zh-CN')}）
                    </li>
                  ))}
              </ul>
            ) : (
              <p>暂无告警。</p>
            )}
          </div>
          {summary.alerts.some((a) => a.resolvedAt !== null) && (
            <details>
              <summary>最近已恢复的告警</summary>
              <ul>
                {summary.alerts
                  .filter((a) => a.resolvedAt !== null)
                  .map((a) => (
                    <li key={`${a.kind}:${a.openedAt}`}>
                      {a.message} · 已恢复：{new Date(a.resolvedAt ?? 0).toLocaleString('zh-CN')}
                    </li>
                  ))}
              </ul>
            </details>
          )}
        </>
      )}
      <Button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError('');
          void requestJson('/api/admin/videos/storage/refresh', {})
            .then((data) => setSummary(storageSummarySchema.parse(data)))
            .catch((error: unknown) =>
              setError(error instanceof Error ? error.message : '同步失败，请稍后重试。'),
            )
            .finally(() => setBusy(false));
        }}
      >
        {busy ? '正在同步…' : summary?.scanning ? '继续同步 B2 容量' : '立即同步 B2 容量'}
      </Button>
      <p className="account-note">
        容量包含旧版本及未完成上传分片；预留量用于防止并发上传超限，可能高于实际占用。告警保存在本站管理后台。
      </p>
    </Panel>
  );
}
