import { Hono } from 'hono';
import { z } from 'zod';
import { assertAuthConfig, currentUser } from './auth.ts';
import { loadMap, ownProgress } from './course.ts';
import type { Bindings } from './bindings.ts';
import type { MemberMap } from '../shared/progress.ts';
import { requestAssessmentInput } from '../shared/assessments.ts';
import { learningDetail, requestAssessment } from './learning.ts';
import { AccessError } from './access.ts';
import { consumeLimit } from './security.ts';

export const member = new Hono<{ Bindings: Bindings }>()
  .use('*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store');
    await next();
  })
  .get('/quest-map', async (c) => {
    assertAuthConfig(c.env, c.req.raw);
    const current = await currentUser(c.env, c.req.raw.headers);
    const map = await loadMap(c.env);
    const result: MemberMap = {
      map,
      progress: current ? await ownProgress(c.env, current.id, map) : null,
    };
    return c.json(result);
  })
  .post('/quests/:id/start', async (c) => {
    assertAuthConfig(c.env, c.req.raw);
    if (c.req.header('Origin') !== c.env.APP_ORIGIN)
      return c.json({ error: { message: '请求来源不受信任。' } }, 403);
    const current = await currentUser(c.env, c.req.raw.headers);
    if (!current) return c.json({ error: { message: '请先激活账号并登录。' } }, 401);
    const input = z.strictObject({}).safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: { message: '请求内容无效。' } }, 400);
    const map = await loadMap(c.env);
    const quest = map.quests.find((item) => item.id === c.req.param('id'));
    if (!quest) return c.json({ error: { message: '任务不存在。' } }, 404);
    const state = await ownProgress(c.env, current.id, map);
    if (!state.find((item) => item.questId === quest.id)?.unlocked)
      return c.json({ error: { message: '请先通过前置任务。' } }, 409);
    // Unique (user_id, quest_id) makes repeat starts safe and preserves reviewed states.
    const result = await c.env.DB.prepare(
      `INSERT INTO progress (user_id,quest_id,learning_status,reward_status,updated_at)
      SELECT ?,?,'in_progress','not_earned',? WHERE EXISTS (SELECT 1 FROM course_revision WHERE id='current' AND revision=?) ON CONFLICT DO NOTHING`,
    )
      .bind(current.id, quest.id, Date.now(), map.revision)
      .run();
    if (
      result.meta.changes === 0 &&
      !(await c.env.DB.prepare('SELECT 1 FROM progress WHERE user_id=? AND quest_id=?')
        .bind(current.id, quest.id)
        .first())
    )
      throw new AccessError('STALE_COURSE', '课程已变化，请刷新后重试。', 409);
    return c.json({ progress: await ownProgress(c.env, current.id, map) });
  })
  .get('/quests/:id/learning', async (c) => {
    assertAuthConfig(c.env, c.req.raw);
    const user = await currentUser(c.env, c.req.raw.headers);
    if (!user) throw new AccessError('NOT_SIGNED_IN', '请先登录。', 401);
    return c.json(await learningDetail(c.env, user.id, c.req.param('id')));
  })
  .post('/quests/:id/assessments', async (c) => {
    assertAuthConfig(c.env, c.req.raw);
    if (c.req.header('Origin') !== c.env.APP_ORIGIN)
      throw new AccessError('INVALID_ORIGIN', '请求来源不受信任。', 403);
    const user = await currentUser(c.env, c.req.raw.headers);
    if (!user) throw new AccessError('NOT_SIGNED_IN', '请先登录。', 401);
    if (!(await consumeLimit(c.env, `assessment:${user.id}`, { window: 60, max: 20 })).allowed)
      throw new AccessError('TOO_MANY_REQUESTS', '操作过于频繁，请稍后重试。', 429);
    const input = requestAssessmentInput.safeParse(await c.req.json().catch(() => null));
    if (!input.success) throw new AccessError('INVALID_INPUT', '考核申请内容无效。', 400);
    await requestAssessment(c.env, user.id, c.req.param('id'), input.data);
    return c.json(await learningDetail(c.env, user.id, c.req.param('id')));
  });
