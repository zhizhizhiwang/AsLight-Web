import { AccessError } from './access.ts';
import { hashToken } from './security.ts';
import { loadMap, ownProgress } from './course.ts';
import type { Bindings } from './bindings.ts';
import type {
  AssessmentRecord,
  RewardRecord,
  LearningDetail,
  OfflineReviewInput,
} from '../shared/assessments.ts';
import type { z } from 'zod';
import type { requestAssessmentInput, rewardDeliveryInput } from '../shared/assessments.ts';

function conflict(): never {
  throw new AccessError('STALE_STATE', '状态已变化，请重新加载后再操作。', 409);
}
function incompatibleRequest(): never {
  throw new AccessError('REQUEST_CONFLICT', '同一操作凭证不能提交不同内容，请重新加载。', 409);
}
async function replay(
  env: Bindings,
  table: 'assessment_attempt' | 'assessment_review',
  key: string,
  fingerprint: string,
) {
  // The table is an internal closed union, never a request parameter.
  const row = await env.DB.prepare(`SELECT request_hash FROM ${table} WHERE request_key=?`)
    .bind(key)
    .first<{ request_hash: string }>();
  if (row && row.request_hash !== fingerprint) incompatibleRequest();
  return !!row;
}
async function context(env: Bindings, userId: string, questId: string) {
  const map = await loadMap(env);
  const quest = map.quests.find((item) => item.id === questId);
  if (!quest) throw new AccessError('NOT_FOUND', '任务不存在。', 404);
  const member = await env.DB.prepare('SELECT id,name,account_state AS state FROM user WHERE id=?')
    .bind(userId)
    .first<{ id: string; name: string; state: 'pending' | 'active' }>();
  if (!member) throw new AccessError('NOT_FOUND', '成员不存在。', 404);
  const progress = (await ownProgress(env, userId, map)).find((item) => item.questId === questId);
  if (!progress) throw new Error('Missing quest state.');
  return { map, quest, member, progress };
}
export async function learningHistory(env: Bindings, userId: string) {
  const records = await env.DB.prepare(
    `SELECT a.id,a.quest_id,a.number,a.requested_at,a.member_note,a.state,
    requester.name AS requester_name,r.id AS review_id,r.decision,r.feedback,r.assessed_at,r.reviewed_at,r.reward_label,reviewer.name AS reviewer_name
    FROM assessment_attempt a JOIN user requester ON requester.id=a.requested_by
    LEFT JOIN assessment_review r ON r.attempt_id=a.id LEFT JOIN user reviewer ON reviewer.id=r.reviewer_id
    WHERE a.user_id=? ORDER BY a.requested_at DESC,a.number DESC,a.id`,
  )
    .bind(userId)
    .all<{
      id: string;
      quest_id: string;
      number: number;
      requested_at: number;
      member_note: string;
      state: 'pending' | 'reviewed';
      requester_name: string;
      review_id: string | null;
      decision: 'passed' | 'needs_revision' | null;
      feedback: string | null;
      assessed_at: number | null;
      reviewed_at: number | null;
      reward_label: string | null;
      reviewer_name: string | null;
    }>();
  const assessments: AssessmentRecord[] = records.results.map((row) => {
    if (
      row.review_id &&
      (!row.decision ||
        row.assessed_at === null ||
        row.reviewed_at === null ||
        row.reviewer_name === null ||
        row.feedback === null)
    )
      throw new Error('Incomplete review record.');
    return {
      id: row.id,
      questId: row.quest_id,
      number: row.number,
      requestedAt: row.requested_at,
      requestedByName: row.requester_name,
      memberNote: row.member_note,
      state: row.state,
      review:
        row.review_id &&
        row.decision &&
        row.assessed_at !== null &&
        row.reviewed_at !== null &&
        row.reviewer_name !== null &&
        row.feedback !== null
          ? {
              id: row.review_id,
              decision: row.decision,
              feedback: row.feedback,
              assessedAt: row.assessed_at,
              reviewedAt: row.reviewed_at,
              reviewerName: row.reviewer_name,
              rewardLabel: row.reward_label,
            }
          : null,
    };
  });
  const grants = await env.DB.prepare(
    `SELECT g.id,g.quest_id,g.label,g.status,g.granted_at,g.delivered_at,g.delivery_note,u.name AS delivered_by_name
    FROM reward_grant g LEFT JOIN user u ON u.id=g.delivered_by WHERE g.user_id=? ORDER BY g.granted_at DESC,g.id`,
  )
    .bind(userId)
    .all<{
      id: string;
      quest_id: string;
      label: string;
      status: 'pending' | 'delivered';
      granted_at: number;
      delivered_at: number | null;
      delivery_note: string;
      delivered_by_name: string | null;
    }>();
  const rewards: RewardRecord[] = grants.results.map((row) => ({
    id: row.id,
    questId: row.quest_id,
    label: row.label,
    status: row.status,
    grantedAt: row.granted_at,
    deliveredAt: row.delivered_at,
    deliveredByName: row.delivered_by_name,
    deliveryNote: row.delivery_note,
  }));
  return { assessments, rewards };
}
export async function learningDetail(
  env: Bindings,
  userId: string,
  questId: string,
): Promise<LearningDetail> {
  const state = await context(env, userId, questId);
  const history = await learningHistory(env, userId);
  return {
    assessments: history.assessments.filter((item) => item.questId === questId),
    reward: history.rewards.find((item) => item.questId === questId) ?? null,
    progress: state.progress,
  };
}

export async function requestAssessment(
  env: Bindings,
  userId: string,
  questId: string,
  input: z.infer<typeof requestAssessmentInput>,
) {
  const key = `submit:${userId}:${input.requestId}`,
    fingerprint = await hashToken(JSON.stringify({ userId, questId, input }));
  if (await replay(env, 'assessment_attempt', key, fingerprint)) return;
  const state = await context(env, userId, questId);
  if (
    state.member.state !== 'active' ||
    !state.progress.unlocked ||
    !['in_progress', 'needs_revision'].includes(state.progress.learningStatus) ||
    state.progress.version !== input.expectedVersion
  )
    conflict();
  const id = crypto.randomUUID(),
    now = Date.now();
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE progress SET learning_status='submitted',version=version+1,operation_id=?,updated_at=?
      WHERE user_id=? AND quest_id=? AND version=? AND learning_status IN ('in_progress','needs_revision') AND EXISTS (SELECT 1 FROM course_revision WHERE id='current' AND revision=?)`,
    ).bind(id, now, userId, questId, input.expectedVersion, state.map.revision),
    env.DB.prepare(
      `INSERT INTO assessment_attempt (id,user_id,quest_id,number,requested_at,requested_by,member_note,state,request_key,request_hash)
      SELECT ?,?,?,(SELECT COALESCE(MAX(number),0)+1 FROM assessment_attempt WHERE user_id=? AND quest_id=?),?,?,?,'pending',?,?
      WHERE EXISTS (SELECT 1 FROM progress WHERE user_id=? AND quest_id=? AND operation_id=?)`,
    ).bind(
      id,
      userId,
      questId,
      userId,
      questId,
      now,
      userId,
      input.note,
      key,
      fingerprint,
      userId,
      questId,
      id,
    ),
  ]);
  if (
    results[0]?.meta.changes !== 1 &&
    !(await replay(env, 'assessment_attempt', key, fingerprint))
  )
    conflict();
}

export async function recordOfflineReview(
  env: Bindings,
  actorId: string,
  userId: string,
  questId: string,
  input: OfflineReviewInput,
) {
  const key = `review:${actorId}:${input.requestId}`,
    fingerprint = await hashToken(JSON.stringify({ userId, questId, input }));
  if (await replay(env, 'assessment_review', key, fingerprint)) return;
  const state = await context(env, userId, questId);
  if (
    state.member.state !== 'active' ||
    !state.progress.unlocked ||
    !['in_progress', 'submitted', 'needs_revision'].includes(state.progress.learningStatus) ||
    state.progress.version !== input.expectedVersion
  )
    conflict();
  const pending = await env.DB.prepare(
    "SELECT id FROM assessment_attempt WHERE user_id=? AND quest_id=? AND state='pending'",
  )
    .bind(userId, questId)
    .first<{ id: string }>();
  if ((pending?.id ?? null) !== input.expectedAttemptId) conflict();
  const reviewId = crypto.randomUUID(),
    attemptId = pending?.id ?? crypto.randomUUID(),
    now = Date.now();
  const guard = 'EXISTS (SELECT 1 FROM progress WHERE user_id=? AND quest_id=? AND operation_id=?)';
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE progress SET learning_status=?,reward_status=CASE WHEN ?='passed' THEN
        CASE WHEN (SELECT reward_label FROM quest WHERE id=?) IS NULL THEN 'not_applicable' ELSE 'pending' END ELSE 'not_earned' END,
        version=version+1,operation_id=?,updated_at=? WHERE user_id=? AND quest_id=? AND version=?
        AND learning_status IN ('in_progress','submitted','needs_revision')
        AND COALESCE((SELECT id FROM assessment_attempt WHERE user_id=? AND quest_id=? AND state='pending'),'')=? AND EXISTS (SELECT 1 FROM course_revision WHERE id='current' AND revision=?)`,
    ).bind(
      input.decision,
      input.decision,
      questId,
      reviewId,
      now,
      userId,
      questId,
      input.expectedVersion,
      userId,
      questId,
      input.expectedAttemptId ?? '',
      state.map.revision,
    ),
    pending
      ? env.DB.prepare(
          `UPDATE assessment_attempt SET state='reviewed' WHERE id=? AND state='pending' AND ${guard}`,
        ).bind(attemptId, userId, questId, reviewId)
      : env.DB.prepare(
          `INSERT INTO assessment_attempt (id,user_id,quest_id,number,requested_at,requested_by,member_note,state,request_key,request_hash)
        SELECT ?,?,?,(SELECT COALESCE(MAX(number),0)+1 FROM assessment_attempt WHERE user_id=? AND quest_id=?),?,?,'','reviewed',?,? WHERE ${guard}`,
        ).bind(
          attemptId,
          userId,
          questId,
          userId,
          questId,
          now,
          actorId,
          key,
          fingerprint,
          userId,
          questId,
          reviewId,
        ),
    env.DB.prepare(
      `INSERT INTO assessment_review (id,attempt_id,reviewer_id,decision,feedback,assessed_at,reviewed_at,reward_label,request_key,request_hash)
      SELECT ?,?,?,?,?,?,?,CASE WHEN ?='passed' THEN (SELECT reward_label FROM quest WHERE id=?) ELSE NULL END,?,? WHERE ${guard}`,
    ).bind(
      reviewId,
      attemptId,
      actorId,
      input.decision,
      input.feedback,
      input.assessedAt,
      now,
      input.decision,
      questId,
      key,
      fingerprint,
      userId,
      questId,
      reviewId,
    ),
    env.DB.prepare(
      `INSERT INTO reward_grant (id,user_id,quest_id,review_id,label,status,granted_at,granted_by)
      SELECT ?,?,?,r.id,r.reward_label,'pending',r.reviewed_at,r.reviewer_id FROM assessment_review r
      WHERE r.id=? AND r.decision='passed' AND r.reward_label IS NOT NULL AND ${guard}`,
    ).bind(crypto.randomUUID(), userId, questId, reviewId, userId, questId, reviewId),
    env.DB.prepare(
      `INSERT INTO audit_event (id,actor_id,target_id,action,reason,created_at) SELECT ?,?,?,?,?,? WHERE ${guard}`,
    ).bind(
      crypto.randomUUID(),
      actorId,
      userId,
      `offline_${input.decision}`,
      `任务 ${questId}，考核记录 ${reviewId}`,
      now,
      userId,
      questId,
      reviewId,
    ),
  ]);
  if (results[0]?.meta.changes !== 1 && !(await replay(env, 'assessment_review', key, fingerprint)))
    conflict();
}

export async function deliverReward(
  env: Bindings,
  actorId: string,
  grantId: string,
  input: z.infer<typeof rewardDeliveryInput>,
) {
  const key = `deliver:${actorId}:${input.requestId}`,
    fingerprint = await hashToken(JSON.stringify({ grantId, note: input.note }));
  const used = await env.DB.prepare(
    'SELECT id,delivery_hash FROM reward_grant WHERE delivery_key=?',
  )
    .bind(key)
    .first<{ id: string; delivery_hash: string | null }>();
  if (used && (used.id !== grantId || used.delivery_hash !== fingerprint)) incompatibleRequest();
  const original = await env.DB.prepare(
    'SELECT user_id,quest_id,status,delivery_key,delivery_hash FROM reward_grant WHERE id=?',
  )
    .bind(grantId)
    .first<{
      user_id: string;
      quest_id: string;
      status: string;
      delivery_key: string | null;
      delivery_hash: string | null;
    }>();
  if (!original) throw new AccessError('NOT_FOUND', '奖励记录不存在。', 404);
  if (original.status === 'delivered') {
    if (original.delivery_key === key && original.delivery_hash === fingerprint) return;
    if (original.delivery_key === key) incompatibleRequest();
    throw new AccessError('ALREADY_DELIVERED', '该奖励已登记领取，请勿重复发放。', 409);
  }
  const operation = crypto.randomUUID(),
    now = Date.now();
  const guard = 'EXISTS (SELECT 1 FROM reward_grant WHERE id=? AND delivery_operation_id=?)';
  const results = await env.DB.batch([
    env.DB.prepare(
      "UPDATE reward_grant SET status='delivered',delivered_by=?,delivered_at=?,delivery_note=?,delivery_key=?,delivery_hash=?,delivery_operation_id=? WHERE id=? AND status='pending'",
    ).bind(actorId, now, input.note, key, fingerprint, operation, grantId),
    env.DB.prepare(
      `UPDATE progress SET reward_status='delivered',version=version+1,operation_id=?,updated_at=? WHERE user_id=? AND quest_id=? AND ${guard}`,
    ).bind(operation, now, original.user_id, original.quest_id, grantId, operation),
    env.DB.prepare(
      `INSERT INTO audit_event (id,actor_id,target_id,action,reason,created_at) SELECT ?,?,?,'reward_delivered',?,? WHERE ${guard}`,
    ).bind(
      crypto.randomUUID(),
      actorId,
      original.user_id,
      `任务 ${original.quest_id}，奖励记录 ${grantId}`,
      now,
      grantId,
      operation,
    ),
  ]);
  if (results[0]?.meta.changes !== 1) {
    const applied = await env.DB.prepare(
      'SELECT delivery_key,delivery_hash FROM reward_grant WHERE id=?',
    )
      .bind(grantId)
      .first<{ delivery_key: string | null; delivery_hash: string | null }>();
    if (applied?.delivery_key === key && applied.delivery_hash === fingerprint) return;
    if (applied?.delivery_key === key) incompatibleRequest();
    throw new AccessError('ALREADY_DELIVERED', '该奖励已登记领取，请刷新查看。', 409);
  }
}
