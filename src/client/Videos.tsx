import { useEffect, useRef, useState } from 'react';
import { Button, Field, Input, Textarea } from './ui.tsx';
import { requestJson } from './auth.ts';
import { requestId } from './learning-request.ts';
import type { PendingOperation } from './learning-request.ts';
import { MAX_VIDEO_BYTES, uploadTicketSchema, videoListSchema } from '../shared/videos.ts';
import type { VideoRecord } from '../shared/videos.ts';

const labels = {
  uploading: '尚未完成上传',
  ready: '视频已上传',
  deleting: '等待清理',
  delete_failed: '清理待重试',
  deleted: '视频已删除',
};
async function videoDuration(file: File) {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<number>((resolve, reject) => {
      const video = document.createElement('video');
      const timer = window.setTimeout(() => {
        video.src = '';
        reject(new Error('无法读取视频时长，请使用 MP4 格式。'));
      }, 10000);
      const finish = () => {
        window.clearTimeout(timer);
        video.onerror = null;
        video.onloadedmetadata = null;
        video.removeAttribute('src');
        video.load();
      };
      video.onloadedmetadata = () => {
        const duration = video.duration;
        finish();
        resolve(duration);
      };
      video.onerror = () => {
        finish();
        reject(new Error('无法读取视频，请使用 MP4 格式。'));
      };
      video.preload = 'metadata';
      video.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
export function VideoSubmission({
  questId,
  version,
  onSubmitted,
}: {
  questId: string;
  version: number;
  onSubmitted: () => void;
}) {
  const [enabled, setEnabled] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const ticket = useRef<{ id: string; complete: boolean } | null>(null);
  const operation = useRef<PendingOperation>(null);
  useEffect(() => {
    const controller = new AbortController();
    void requestJson(
      `/api/videos?questId=${encodeURIComponent(questId)}`,
      undefined,
      controller.signal,
    )
      .then((data) => setEnabled(videoListSchema.parse(data).enabled))
      .catch(() => {
        if (!controller.signal.aborted) setMessage('视频服务暂不可用，可申请线下考核。');
      });
    return () => controller.abort();
  }, [questId]);
  if (!enabled)
    return <p className="account-note">{message || '视频服务尚未开放，可申请线下考核。'}</p>;
  return (
    <form
      className="form-stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || !file) return;
        const note = String(new FormData(event.currentTarget).get('note') ?? '').trim();
        setBusy(true);
        setMessage('正在检查视频…');
        void (async () => {
          if (file.size > MAX_VIDEO_BYTES) throw new Error('视频不能超过 100 MiB。');
          const duration = await videoDuration(file);
          if (!Number.isFinite(duration) || duration <= 0 || duration > 60.5)
            throw new Error('请选择一分钟以内的视频。');
          if (!ticket.current) {
            const upload = uploadTicketSchema.parse(
              await requestJson('/api/videos', { questId, size: file.size, mimeType: file.type }),
            );
            setMessage('正在上传视频，请保持页面打开…');
            const response = await fetch(upload.url, {
              method: 'PUT',
              headers: upload.headers,
              body: file,
              credentials: 'omit',
              referrerPolicy: 'no-referrer',
            });
            if (!response.ok) throw new Error('视频上传失败，请重新选择文件后重试。');
            ticket.current = { id: upload.id, complete: false };
          }
          if (!ticket.current.complete) {
            await requestJson(`/api/videos/${ticket.current.id}/complete`, {});
            ticket.current.complete = true;
          }
          const payload = { expectedVersion: version, note, videoId: ticket.current.id };
          await requestJson(`/api/member/quests/${encodeURIComponent(questId)}/assessments`, {
            ...payload,
            requestId: requestId(operation, payload),
          });
          setMessage('视频已提交，等待管理员考核。');
          onSubmitted();
        })()
          .catch((error: unknown) =>
            setMessage(error instanceof Error ? error.message : '提交未成功，请重试。'),
          )
          .finally(() => setBusy(false));
      }}
    >
      <h3>提交视频考核</h3>
      <p>
        请选择一分钟以内、不超过 100 MiB 的视频，推荐
        MP4。视频仅供管理员考核，由管理员决定何时删除；考核结果会保留。
      </p>
      <Field>
        视频文件
        <Input
          type="file"
          accept="video/mp4,video/webm,video/quicktime"
          required
          disabled={busy}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            ticket.current = null;
            operation.current = null;
            setMessage('');
          }}
        />
      </Field>
      <Field>
        提交备注（选填）
        <Textarea name="note" maxLength={1000} rows={2} disabled={busy} />
      </Field>
      <Button type="submit" variant="primary" disabled={busy || !file}>
        {busy ? '正在提交…' : '上传并申请考核'}
      </Button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
export function AdminVideos({
  userId,
  questId,
  revision,
}: {
  userId: string;
  questId: string;
  revision: number;
}) {
  const [videos, setVideos] = useState<VideoRecord[]>([]),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0),
    [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void requestJson(
      `/api/admin/videos/members/${encodeURIComponent(userId)}/quests/${encodeURIComponent(questId)}`,
      undefined,
      controller.signal,
    )
      .then((list) => {
        if (controller.signal.aborted) return;
        setVideos(videoListSchema.parse(list).videos);
        setError('');
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('视频记录加载失败，请重试。');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [userId, questId, retry, revision]);
  return (
    <section className="form-stack" aria-label="考核视频">
      <h3>考核视频</h3>
      <Button disabled={busy} onClick={() => setRetry((n) => n + 1)}>
        刷新视频记录
      </Button>
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">正在加载视频记录…</p>}
      {!loading && !error && !videos.length && <p>暂无视频，可按线下流程登记考核。</p>}
      {videos.map((video) => (
        <div className="form-stack" key={video.id}>
          <p>
            {labels[video.status]} · {(video.size / 1024 / 1024).toFixed(1)} MiB ·{' '}
            {new Date(video.createdAt).toLocaleString('zh-CN')}
            {!video.attemptId ? ' · 尚未提交考核' : ''}
          </p>
          {video.status === 'ready' && video.attemptId && (
            <video
              style={{ width: '100%', maxHeight: 400 }}
              controls
              preload="none"
              src={`/api/admin/videos/${video.id}/stream`}
            />
          )}
          {['uploading', 'ready'].includes(video.status) && (
            <form
              className="form-stack"
              onSubmit={(e) => {
                e.preventDefault();
                if (busy) return;
                const reason = String(new FormData(e.currentTarget).get('reason') ?? '').trim();
                if (!window.confirm('确认永久删除此视频？考核和奖励记录会保留。')) return;
                setBusy(true);
                setError('');
                void requestJson(`/api/admin/videos/${video.id}/delete`, { reason })
                  .then(() => setRetry((n) => n + 1))
                  .catch(() => setError('删除请求未成功，请重试。'))
                  .finally(() => setBusy(false));
              }}
            >
              <Field>
                删除原因
                <Input name="reason" required maxLength={300} disabled={busy} />
              </Field>
              <Button type="submit" disabled={busy}>
                停止播放并永久删除视频
              </Button>
            </form>
          )}
        </div>
      ))}
    </section>
  );
}
