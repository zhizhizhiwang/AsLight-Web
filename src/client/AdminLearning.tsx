import { Button, Input, Select, Textarea, Field, Panel, ButtonLink } from './ui.tsx';
import { useEffect, useRef, useState } from 'react';
import { AdminVideos } from './Videos.tsx';
import { StoragePanel } from './StoragePanel.tsx';
import type { FormEvent } from 'react';
import { z } from 'zod';
import { authClient, requestJson } from './auth.ts';
import { adminLearningViewSchema } from '../shared/assessments.ts';
import type { AdminLearningView } from '../shared/assessments.ts';
import { AssessmentHistory, RewardSummary } from './AssessmentHistory.tsx';
import { progressLabel, rewardLabel } from './progress.ts';
import { requestId } from './learning-request.ts';
import type { PendingOperation } from './learning-request.ts';

const membersSchema = z.object({
  members: z.array(
    z.object({ id: z.string(), name: z.string(), state: z.enum(['pending', 'active']) }),
  ),
});
type Member = z.infer<typeof membersSchema>['members'][number];

function localNow() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function LearningEditor({
  view,
  questId,
  refresh,
}: {
  view: AdminLearningView;
  questId: string;
  refresh: () => void;
}) {
  const quest = view.map.quests.find((item) => item.id === questId);
  const progress = view.progress.find((item) => item.questId === questId);
  const records = view.assessments.filter((item) => item.questId === questId);
  const pending = records.find((item) => item.state === 'pending');
  const reward = view.rewards.find((item) => item.questId === questId) ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [decision, setDecision] = useState('passed');
  const reviewOperation = useRef<PendingOperation>(null);
  const deliveryOperation = useRef<PendingOperation>(null);
  if (!quest || !progress) return <p>任务不存在。</p>;
  const canReview =
    view.member.state === 'active' &&
    progress.unlocked &&
    ['in_progress', 'submitted', 'needs_revision'].includes(progress.learningStatus);
  async function submit(
    event: FormEvent<HTMLFormElement>,
    action: 'review' | 'reward' | 'deliver',
  ) {
    event.preventDefault();
    if (busy || !quest || !progress) return;
    const values = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (action === 'review') {
        const payload = {
          expectedVersion: progress.version,
          expectedAttemptId: pending?.id ?? null,
          decision: String(values.get('decision')),
          feedback: String(values.get('feedback') ?? '').trim(),
          assessedAt: new Date(String(values.get('assessedAt'))).getTime(),
        };
        await requestJson(
          `/api/admin/learning/members/${encodeURIComponent(view.member.id)}/quests/${encodeURIComponent(quest.id)}/review`,
          { ...payload, requestId: requestId(reviewOperation, payload) },
        );
        reviewOperation.current = null;
        setMessage('考核结果已保存。');
      } else if (action === 'reward') {
        const label = String(values.get('label') ?? '').trim() || null;
        await requestJson(`/api/admin/learning/quests/${encodeURIComponent(quest.id)}/reward`, {
          expectedVersion: quest.rewardVersion ?? 0,
          label,
        });
        setMessage('任务奖励设置已保存。');
      } else if (reward) {
        const payload = { note: String(values.get('note') ?? '').trim() };
        await requestJson(`/api/admin/learning/rewards/${encodeURIComponent(reward.id)}/deliver`, {
          ...payload,
          requestId: requestId(deliveryOperation, { rewardId: reward.id, ...payload }),
        });
        deliveryOperation.current = null;
        setMessage('已登记奖励领取。');
      }
      refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : '操作未成功。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="learning-editor">
      <Panel>
        <p className="section-kicker">{view.member.name}</p>
        <h2>{quest.title}</h2>
        <p>
          {progressLabel(progress)}
          {rewardLabel(progress) ? ` · ${rewardLabel(progress)}` : ''}
        </p>
        <p>{quest.summary}</p>
        <AdminVideos
          key={`${view.member.id}:${quest.id}`}
          userId={view.member.id}
          questId={quest.id}
          revision={progress.version}
        />
        {canReview ? (
          <form className="form-stack" onSubmit={(event) => void submit(event, 'review')}>
            <h3>{pending ? '处理考核申请' : '直接登记线下考核'}</h3>
            {pending?.memberNote && <p className="preserve-text">成员备注：{pending.memberNote}</p>}
            <Field>
              考核结果
              <Select
                name="decision"
                value={decision}
                onChange={(event) => setDecision(event.target.value)}
              >
                <option value="passed">通过</option>
                <option value="needs_revision">需修改</option>
              </Select>
            </Field>
            <Field>
              实际考核时间
              <Input name="assessedAt" type="datetime-local" required defaultValue={localNow()} />
            </Field>
            <Field>
              反馈{decision === 'needs_revision' ? '（必填）' : '（选填）'}
              <Textarea
                name="feedback"
                rows={3}
                required={decision === 'needs_revision'}
                maxLength={2000}
              />
            </Field>
            <p className="account-note">
              请观看视频或在线下完成考核后登记。保存后保留记录；需修改时，成员可重新申请。视频由你另行决定何时删除。
            </p>
            <Button variant="primary" type="submit" disabled={busy}>
              保存考核结果
            </Button>
          </form>
        ) : (
          <p>
            {progress.learningStatus === 'passed'
              ? '任务已通过，考核结果已保留。'
              : view.member.state === 'pending'
                ? '成员尚未激活账号。'
                : '请成员先解锁并开始学习，再登记考核。'}
          </p>
        )}
      </Panel>
      {message && (
        <p role="status" className="form-message">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}{' '}
          <Button disabled={busy} onClick={refresh}>
            重新加载
          </Button>
        </p>
      )}
      <Panel>
        <h2>奖励领取登记</h2>
        <RewardSummary reward={reward} />
        {!reward && (
          <p>
            {progress.learningStatus === 'passed'
              ? '该成员本次通过没有待发放的奖励。'
              : '任务通过后，如设置了奖励，将生成待领取记录。'}
          </p>
        )}
        {reward?.status === 'pending' && (
          <form className="form-stack" onSubmit={(event) => void submit(event, 'deliver')}>
            <Field>
              领取备注（选填）
              <Textarea name="note" maxLength={1000} rows={2} />
            </Field>
            <p className="account-note">请实际交付给该成员后登记，系统会记录你的账号和登记时间。</p>
            <Button variant="primary" type="submit" disabled={busy}>
              确认已线下交付，登记领取
            </Button>
          </form>
        )}
      </Panel>
      <Panel>
        <AssessmentHistory records={records} />
      </Panel>
      <Panel>
        <h2>任务奖励设置</h2>
        <p>此设置对所有成员之后通过本任务时生效，已有奖励记录保持原样。</p>
        <form className="form-stack" onSubmit={(event) => void submit(event, 'reward')}>
          <Field>
            奖励说明（留空表示无奖励）
            <Input name="label" maxLength={200} defaultValue={quest.rewardLabel ?? ''} />
          </Field>
          <Button type="submit" variant="primary" disabled={busy}>
            保存任务奖励设置
          </Button>
        </form>
      </Panel>
    </div>
  );
}

export function AdminLearning() {
  const { data, isPending } = authClient.useSession();
  const permitted = data?.user.role === 'admin';
  const [members, setMembers] = useState<Member[]>([]);
  const [memberId, setMemberId] = useState('');
  const [questId, setQuestId] = useState('');
  const [saved, setSaved] = useState<{ actor: string; view: AdminLearningView } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [memberRetry, setMemberRetry] = useState(0);
  const reload = () => {
    if (!members.length) setMemberRetry((value) => value + 1);
    else setRetry((value) => value + 1);
  };
  const view =
    saved?.actor === data?.user.id && saved?.view.member.id === memberId ? saved.view : null;
  useEffect(() => {
    setMembers([]);
    setMemberId('');
    setSaved(null);
    setError('');
    if (!permitted) return;
    const controller = new AbortController();
    void requestJson('/api/admin/members', undefined, controller.signal)
      .then((result) => {
        const members = membersSchema.parse(result).members;
        if (!controller.signal.aborted) setMembers(members);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : '无法加载成员。');
      });
    return () => controller.abort();
  }, [permitted, data?.user.id, memberRetry]);
  useEffect(() => {
    setSaved(null);
    setError('');
    if (!permitted || !memberId || !data) return;
    const controller = new AbortController();
    setLoading(true);
    void requestJson(
      `/api/admin/learning/members/${encodeURIComponent(memberId)}`,
      undefined,
      controller.signal,
    )
      .then((result) => {
        const view = adminLearningViewSchema.parse(result);
        if (!controller.signal.aborted) {
          setSaved({ actor: data.user.id, view });
          setQuestId((id) =>
            view.map.quests.some((q) => q.id === id) ? id : (view.map.quests[0]?.id ?? ''),
          );
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : '无法加载考核与奖励。');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [permitted, data?.user.id, memberId, retry]);
  if (isPending) return <div className="empty-state">正在检查管理权限…</div>;
  if (!permitted)
    return (
      <div className="empty-state">
        <p>{data ? '当前账号没有管理权限。' : '请先使用管理员账号登录。'}</p>
        <ButtonLink to="/account">前往个人账号</ButtonLink>
      </div>
    );
  return (
    <div className="admin-page">
      <ButtonLink to="/admin">返回成员管理</ButtonLink>
      <StoragePanel />
      <Panel className="form-stack">
        <h2>考核与奖励</h2>
        <Field>
          选择成员
          <Select value={memberId} onChange={(event) => setMemberId(event.target.value)}>
            <option value="">请选择成员</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
                {member.state === 'pending' ? '（待激活）' : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Button disabled={loading} onClick={reload}>
          刷新考核与奖励
        </Button>
      </Panel>
      {error && (
        <p role="alert" className="form-error">
          {error} <Button onClick={reload}>重试</Button>
        </p>
      )}
      {loading ? (
        <p role="status">正在加载…</p>
      ) : view ? (
        <>
          <Panel className="form-stack">
            <Field>
              选择任务
              <Select value={questId} onChange={(event) => setQuestId(event.target.value)}>
                {view.map.quests.map((quest) => {
                  const state = view.progress.find((item) => item.questId === quest.id);
                  return (
                    <option key={quest.id} value={quest.id}>
                      {quest.title} · {progressLabel(state)}
                      {rewardLabel(state) ? ` · ${rewardLabel(state)}` : ''}
                    </option>
                  );
                })}
              </Select>
            </Field>
          </Panel>
          <LearningEditor
            key={`${view.member.id}:${questId}:${view.progress.find((item) => item.questId === questId)?.version}:${view.map.quests.find((item) => item.id === questId)?.rewardVersion}`}
            view={view}
            questId={questId}
            refresh={() => setRetry((value) => value + 1)}
          />
        </>
      ) : (
        !memberId && <p>请选择要登记考核或奖励的成员。</p>
      )}
    </div>
  );
}
