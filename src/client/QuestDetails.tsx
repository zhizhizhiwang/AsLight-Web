import { Button, Textarea, Field, ButtonLink } from './ui.tsx';
import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon.tsx';
import { ContentBlocks, QuestArtwork } from './CourseContent.tsx';
import type { Chapter, Quest } from '../shared/quests.ts';
import type { QuestProgress } from '../shared/progress.ts';
import { api } from './api.ts';
import { progressLabel } from './progress.ts';
import { authClient, requestJson } from './auth.ts';
import { learningDetailSchema } from '../shared/assessments.ts';
import type { LearningDetail } from '../shared/assessments.ts';
import { AssessmentHistory, RewardSummary } from './AssessmentHistory.tsx';
import { requestId } from './learning-request.ts';
import type { PendingOperation } from './learning-request.ts';
import type { FormEvent } from 'react';

interface Props {
  quest: Quest;
  quests: Quest[];
  chapters: Chapter[];
  onSelect: (id: string) => void;
  onClose: () => void;
  progress: QuestProgress | undefined;
  onStarted: () => void;
  readOnlyPreview?: boolean;
}

export function QuestDetails({
  quest,
  quests,
  chapters,
  progress,
  onSelect,
  onClose,
  onStarted,
  readOnlyPreview = false,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { data: session } = authClient.useSession();
  const [saved, setSaved] = useState<{
    owner: string;
    questId: string;
    detail: LearningDetail;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const operation = useRef<PendingOperation>(null);
  const detail =
    saved?.owner === session?.user.id && saved?.questId === quest.id ? saved.detail : null;
  const current = detail?.progress ?? progress;
  useEffect(() => {
    setSaved(null);
    setError('');
    operation.current = null;
    if (readOnlyPreview || !session?.user.id || !progress) return;
    const controller = new AbortController();
    setLoading(true);
    void requestJson(
      `/api/member/quests/${encodeURIComponent(quest.id)}/learning`,
      undefined,
      controller.signal,
    )
      .then((result) => {
        const detail = learningDetailSchema.parse(result);
        if (!controller.signal.aborted)
          setSaved({ owner: session.user.id, questId: quest.id, detail });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : '无法加载考核记录。');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [
    quest.id,
    session?.user.id,
    progress?.version,
    progress?.learningStatus,
    progress?.rewardStatus,
    retry,
    readOnlyPreview,
  ]);
  async function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !detail) return;
    const payload = {
      expectedVersion: detail.progress.version,
      note: String(new FormData(event.currentTarget).get('note') ?? '').trim(),
    };
    setBusy(true);
    setError('');
    try {
      await requestJson(`/api/member/quests/${encodeURIComponent(quest.id)}/assessments`, {
        ...payload,
        requestId: requestId(operation, payload),
      });
      operation.current = null;
      onStarted();
      setRetry((value) => value + 1);
    } catch (error) {
      setError(error instanceof Error ? error.message : '申请未成功。');
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    setBusy(true);
    setError('');
    try {
      const response = await api.api.member.quests[':id'].start.$post(
        { param: { id: quest.id } },
        { init: { headers: { 'Content-Type': 'application/json' }, body: '{}' } },
      );
      if (!response.ok) {
        setError('暂时无法保存，请确认已登录且前置任务已通过，再重试。');
        return;
      }
      onStarted();
    } catch {
      setError('无法连接服务，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  useEffect(() => {
    closeRef.current?.focus();
  }, [quest.id]);

  return (
    <dialog
      ref={ref}
      className="quest-dialog"
      aria-labelledby="quest-detail-title"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <article className="quest-detail">
        <header className="detail-header">
          <span className={`quest-kind-label ${quest.kind}`}>
            {quest.kind === 'main' ? '主线任务' : '支线任务'}
          </span>
          <Button
            ref={closeRef}
            variant="icon"
            onClick={onClose}
            aria-label="关闭任务详情"
            autoFocus
          >
            <Icon name="close" />
          </Button>
        </header>
        <div className="detail-title">
          <span className={`detail-quest-mark ${quest.kind}`} aria-hidden="true">
            <QuestArtwork quest={quest} />
          </span>
          <div>
            <p className="section-kicker">任务详情</p>
            <h2 id="quest-detail-title">{quest.title}</h2>
          </div>
        </div>
        <section className="detail-section">
          <h3>任务内容</h3>
          {quest.content?.length ? (
            <ContentBlocks blocks={quest.content} />
          ) : (
            <p>{quest.summary}</p>
          )}
        </section>
        {Boolean(quest.assessmentContent?.length) && (
          <section className="detail-section">
            <h3>考核内容</h3>
            <ContentBlocks blocks={quest.assessmentContent ?? []} />
          </section>
        )}
        <section className="detail-section">
          <h3>前置任务</h3>
          {quest.prerequisites.length ? (
            <>
              <p>
                {quest.prerequisiteMode === 'all'
                  ? '请先通过以下全部任务。'
                  : '通过以下任意一项任务即可。'}
              </p>
              <div className="prerequisite-links">
                {quest.prerequisites.map((id) => {
                  const prerequisite = quests.find((item) => item.id === id);
                  const sourceChapter = chapters.find(
                    (item) => item.id === prerequisite?.chapterId,
                  );
                  return (
                    <Button key={id} onClick={() => onSelect(id)} disabled={!prerequisite}>
                      {prerequisite?.chapterId !== quest.chapterId && (
                        <span>{sourceChapter?.title ?? '其他章节'} · </span>
                      )}
                      {prerequisite?.title ?? '任务暂不可用'}
                      <Icon name="arrow" />
                    </Button>
                  );
                })}
              </div>
            </>
          ) : (
            <p>无前置任务。</p>
          )}
        </section>
        {!readOnlyPreview && (
          <footer className="detail-footer">
            <div>
              <strong>{progressLabel(current)}</strong>
              <p>
                {current?.learningStatus === 'submitted'
                  ? '已申请，请与管理员约定线下考核。'
                  : '完成学习后可申请线下考核，由管理员登记结果。'}
              </p>
            </div>
            {!progress ? (
              <ButtonLink to="/account" onClick={onClose}>
                登录后保存进度
              </ButtonLink>
            ) : (
              progress.learningStatus === 'not_started' && (
                <Button
                  variant="primary"
                  disabled={!progress.unlocked || busy}
                  onClick={() => void start()}
                >
                  {busy ? '正在保存…' : progress.unlocked ? '开始学习' : '请先通过前置任务'}
                </Button>
              )
            )}
            {error && <p role="alert">{error}</p>}
          </footer>
        )}
        {quest.rewardLabel && (
          <section className="detail-section">
            <h3>任务奖励</h3>
            <p>{quest.rewardLabel}</p>
          </section>
        )}
        {progress && (
          <section className="detail-section">
            {loading && <p role="status">正在加载考核记录…</p>}
            <Button
              variant="ghost"
              disabled={busy || loading}
              onClick={() => {
                onStarted();
                setRetry((value) => value + 1);
              }}
            >
              刷新考核与奖励
            </Button>
            {detail && (
              <>
                {detail.progress.unlocked &&
                  ['in_progress', 'needs_revision'].includes(detail.progress.learningStatus) && (
                    <form className="form-stack" onSubmit={(event) => void apply(event)}>
                      <Field>
                        申请备注（选填）
                        <Textarea name="note" maxLength={1000} rows={2} />
                      </Field>
                      <Button variant="primary" type="submit" disabled={busy || loading}>
                        {busy
                          ? '正在提交…'
                          : detail.progress.learningStatus === 'needs_revision'
                            ? '重新申请线下考核'
                            : '申请线下考核'}
                      </Button>
                    </form>
                  )}
                <RewardSummary reward={detail.reward} />
                <AssessmentHistory records={detail.assessments} />
              </>
            )}
          </section>
        )}
      </article>
    </dialog>
  );
}
