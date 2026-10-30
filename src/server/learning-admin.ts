import { Hono } from 'hono';
import {
  offlineReviewInput,
  rewardDeliveryInput,
  rewardSettingInput,
} from '../shared/assessments.ts';
import { loadMap, ownProgress } from './course.ts';
import { learningHistory, recordOfflineReview, deliverReward } from './learning.ts';
import { AccessError } from './access.ts';
import type { AdminContext } from './admin-context.ts';

// Mounted under admin's authenticated role/origin/rate-limit middleware.
export const learningAdmin = new Hono<AdminContext>()
  .get('/members/:id', async (c) => {
    const member = await c.env.DB.prepare(
      'SELECT id,name,account_state AS state FROM user WHERE id=?',
    )
      .bind(c.req.param('id'))
      .first<{ id: string; name: string; state: 'pending' | 'active' }>();
    if (!member) throw new AccessError('NOT_FOUND', '成员不存在。', 404);
    const map = await loadMap(c.env);
    return c.json({
      member,
      map,
      progress: await ownProgress(c.env, member.id, map),
      ...(await learningHistory(c.env, member.id)),
    });
  })
  .post('/members/:id/quests/:questId/review', async (c) => {
    const input = offlineReviewInput.safeParse(await c.req.json().catch(() => null));
    if (!input.success)
      throw new AccessError('INVALID_INPUT', '请检查考核时间和结果，退回时必须填写修改意见。', 400);
    await recordOfflineReview(
      c.env,
      c.get('actor').id,
      c.req.param('id'),
      c.req.param('questId'),
      input.data,
    );
    return c.json({ success: true });
  })
  .post('/rewards/:id/deliver', async (c) => {
    const input = rewardDeliveryInput.safeParse(await c.req.json().catch(() => null));
    if (!input.success) throw new AccessError('INVALID_INPUT', '奖励登记内容无效。', 400);
    await deliverReward(c.env, c.get('actor').id, c.req.param('id'), input.data);
    return c.json({ success: true });
  })
  .post('/quests/:id/reward', async (c) => {
    const input = rewardSettingInput.safeParse(await c.req.json().catch(() => null));
    if (!input.success)
      throw new AccessError('INVALID_INPUT', '请填写奖励说明，或选择不设置奖励。', 400);
    const quest = await c.env.DB.prepare(
      'SELECT reward_label,reward_version FROM quest WHERE id=? AND archived=0',
    )
      .bind(c.req.param('id'))
      .first<{ reward_label: string | null; reward_version: number }>();
    if (!quest) throw new AccessError('NOT_FOUND', '任务不存在。', 404);
    if (quest.reward_label === input.data.label) return c.json({ success: true });
    if (quest.reward_version !== input.data.expectedVersion)
      throw new AccessError('STALE_STATE', '奖励设置已变化，请重新加载。', 409);
    const operation = crypto.randomUUID(),
      now = Date.now();
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        'UPDATE quest SET reward_label=?,reward_version=reward_version+1,reward_operation_id=? WHERE id=? AND reward_version=? AND archived=0',
      ).bind(input.data.label, operation, c.req.param('id'), input.data.expectedVersion),
      c.env.DB.prepare(
        `INSERT INTO audit_event (id,actor_id,target_id,action,reason,created_at)
        SELECT ?,?,?,'quest_reward_updated',?,? WHERE EXISTS(SELECT 1 FROM quest WHERE id=? AND reward_operation_id=?)`,
      ).bind(
        crypto.randomUUID(),
        c.get('actor').id,
        c.get('actor').id,
        `任务 ${c.req.param('id')}：${input.data.label ?? '不设置奖励'}`,
        now,
        c.req.param('id'),
        operation,
      ),
    ]);
    if (results[0]?.meta.changes !== 1)
      throw new AccessError('STALE_STATE', '奖励设置已变化，请重新加载。', 409);
    return c.json({ success: true });
  });
