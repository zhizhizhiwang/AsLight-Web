import { Hono } from 'hono';
import { assertAuthConfig, currentUser } from './auth.ts';
import { AccessError } from './access.ts';
import { readCourse } from './course.ts';
import { consumeLimit, hashToken } from './security.ts';
import type { Bindings } from './bindings.ts';
import { courseDocumentSchema, saveCourseSchema } from '../shared/editor.ts';
import type { CourseDocument } from '../shared/editor.ts';
import {
  chapterPresentationSchema,
  contentAssetIds,
  courseAssetSchema,
} from '../shared/content.ts';
import { questDefinitionSchema } from '../shared/quests.ts';
import { validateQuestGraph } from './domain/quest-graph.ts';

export async function canEdit(env: Bindings, userId: string) {
  const row = await env.DB.prepare('SELECT can_edit FROM content_permission WHERE user_id=?')
    .bind(userId)
    .first<{ can_edit: number }>();
  return row?.can_edit === 1;
}

export async function editorSnapshot(env: Bindings) {
  const rows = await readCourse(env);
  const protectedRows = await env.DB.prepare(
    'SELECT quest_id FROM progress UNION SELECT quest_id FROM assessment_attempt UNION SELECT quest_id FROM reward_grant',
  ).all<{ quest_id: string }>();
  return {
    revision: rows.revision,
    updatedAt: rows.updatedAt,
    updatedBy: rows.updatedBy,
    protectedQuestIds: protectedRows.results.map((row) => row.quest_id),
    document: courseDocumentSchema.parse({
      chapters: rows.chapters.map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description,
        sortOrder: row.sortOrder,
        icon: row.icon,
        archived: row.status !== 'published',
        presentation: chapterPresentationSchema.parse(JSON.parse(row.presentation)),
      })),
      quests: rows.quests.map((row) => ({
        ...questDefinitionSchema.parse(JSON.parse(row.definition)),
        archived: row.archived,
      })),
    }),
    assets: rows.assets.flatMap(({ status: _status, ...row }) => {
      const parsed = courseAssetSchema.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    }),
  };
}

export function validateDocument(document: CourseDocument, assetIds: ReadonlySet<string>) {
  const fail = () => {
    throw new AccessError(
      'INVALID_COURSE',
      '请检查章节、前置关系与图片引用；启用的任务不能依赖已归档内容。',
      400,
    );
  };
  if (
    new Set(document.chapters.map((c) => c.id)).size !== document.chapters.length ||
    new Set(document.quests.map((q) => q.id)).size !== document.quests.length
  )
    fail();
  const chapters = new Map(document.chapters.map((c) => [c.id, c]));
  for (const q of document.quests) if (!chapters.has(q.chapterId)) fail();
  const active = document.quests.filter((q) => !q.archived && !chapters.get(q.chapterId)?.archived);
  try {
    validateQuestGraph(active);
  } catch {
    fail();
  }
  const refs: string[] = [];
  for (const c of document.chapters) {
    const p = c.presentation;
    if (p?.iconAssetId) refs.push(p.iconAssetId);
    if (p?.backgroundAssetId) refs.push(p.backgroundAssetId);
    for (const item of p?.decorations ?? []) if (item.type === 'image') refs.push(item.assetId);
  }
  for (const q of document.quests) {
    if (q.imageAssetId) refs.push(q.imageAssetId);
    refs.push(...contentAssetIds(q.content), ...contentAssetIds(q.assessmentContent));
  }
  if (refs.some((id) => !assetIds.has(id))) fail();
}

export const content = new Hono<{ Bindings: Bindings; Variables: { actor: string } }>()
  .use('*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store');
    assertAuthConfig(c.env, c.req.raw);
    if (c.req.method !== 'GET' && c.req.header('Origin') !== c.env.APP_ORIGIN)
      throw new AccessError('INVALID_ORIGIN', '请求来源不受信任。', 403);
    const user = await currentUser(c.env, c.req.raw.headers);
    if (c.req.path.endsWith('/access') && c.req.method === 'GET')
      return c.json({ canEdit: user ? await canEdit(c.env, user.id) : false });
    if (!user) throw new AccessError('NOT_SIGNED_IN', '请先登录。', 401);
    if (!(await canEdit(c.env, user.id)))
      throw new AccessError('FORBIDDEN', '当前账号没有内容编辑权限。', 403);
    c.set('actor', user.id);
    if (
      c.req.method !== 'GET' &&
      !(await consumeLimit(c.env, `content:${user.id}`, { window: 60, max: 20 })).allowed
    )
      throw new AccessError('TOO_MANY_REQUESTS', '操作过于频繁，请稍后重试。', 429);
    await next();
  })
  .get('/course', async (c) => c.json(await editorSnapshot(c.env)))
  .post('/course', async (c) => {
    const parsed = saveCourseSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AccessError('INVALID_INPUT', '请检查填写内容和修改说明。', 400);
    const input = parsed.data,
      actor = c.get('actor'),
      key = `${actor}:${input.requestId}`,
      hash = await hashToken(JSON.stringify(input));
    const replay = async () => {
      const old = await c.env.DB.prepare(
        'SELECT request_hash FROM course_change WHERE request_key=?',
      )
        .bind(key)
        .first<{ request_hash: string }>();
      if (old && old.request_hash !== hash)
        throw new AccessError('REQUEST_CONFLICT', '该请求已经用于其他修改。', 409);
      return Boolean(old);
    };
    if (await replay()) return c.json(await editorSnapshot(c.env));
    const before = await editorSnapshot(c.env);
    if (before.revision !== input.expectedRevision)
      throw new AccessError('STALE_COURSE', '课程已被他人修改，请重新加载后核对。', 409);
    const deleted = input.deletedQuestIds ?? [],
      deletedSet = new Set(deleted);
    const keptIds = new Set(input.document.quests.map((q) => q.id));
    const removed = before.document.quests.filter((q) => !keptIds.has(q.id));
    if (
      before.document.chapters.some(
        (c) => !input.document.chapters.some((next) => next.id === c.id),
      ) ||
      removed.length !== deleted.length ||
      removed.some((q) => !deletedSet.has(q.id))
    )
      throw new AccessError(
        'COURSE_IDENTITY',
        '章节不能移除；删除任务必须明确指定并通过关联检查。',
        400,
      );
    if (input.document.quests.some((q) => q.prerequisites.some((id) => deletedSet.has(id))))
      throw new AccessError(
        'DELETE_REFERENCED',
        '其他任务仍引用待删除任务，请先移除前置关系。',
        409,
      );
    if (deleted.some((id) => before.protectedQuestIds.includes(id)))
      throw new AccessError('DELETE_BLOCKED', '任务已有学习、考核或奖励记录，请使用归档。', 409);
    const existingIds = new Set(before.document.quests.map((q) => q.id));
    const newIds = input.document.quests.filter((q) => !existingIds.has(q.id)).map((q) => q.id);
    if (
      newIds.length &&
      (await c.env.DB.prepare(
        'SELECT id FROM course_quest_deletion WHERE id IN (SELECT value FROM json_each(?)) LIMIT 1',
      )
        .bind(JSON.stringify(newIds))
        .first())
    )
      throw new AccessError('TASK_ID_REUSED', '已删除任务的编号不能重新使用，请创建新任务。', 400);
    validateDocument(input.document, new Set(before.assets.map((a) => a.id)));
    const changedRules = before.document.quests
      .filter((old) => {
        const next = input.document.quests.find((q) => q.id === old.id);
        return (
          next &&
          (JSON.stringify([...old.prerequisites].sort()) !==
            JSON.stringify([...next.prerequisites].sort()) ||
            old.prerequisiteMode !== next.prerequisiteMode ||
            JSON.stringify(old.assessmentContent ?? []) !==
              JSON.stringify(next.assessmentContent ?? []))
        );
      })
      .map((q) => q.id);
    const operation = crypto.randomUUID(),
      now = Date.now(),
      document = JSON.stringify(input.document);
    const guard = "EXISTS (SELECT 1 FROM course_revision WHERE id='current' AND operation_id=?)";
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE course_revision SET revision=revision+1,updated_at=?,updated_by=?,operation_id=? WHERE id='current' AND revision=? AND EXISTS (SELECT 1 FROM content_permission WHERE user_id=? AND can_edit=1)
        AND NOT EXISTS (SELECT 1 FROM progress WHERE quest_id IN (SELECT value FROM json_each(?)))
        AND NOT EXISTS (SELECT 1 FROM assessment_attempt WHERE quest_id IN (SELECT value FROM json_each(?)))
        AND NOT EXISTS (SELECT 1 FROM reward_grant WHERE quest_id IN (SELECT value FROM json_each(?)))
        AND NOT EXISTS (SELECT 1 FROM course_quest_deletion WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(?,'$.quests')))`,
      ).bind(
        now,
        actor,
        operation,
        input.expectedRevision,
        actor,
        JSON.stringify([...changedRules, ...deleted]),
        JSON.stringify(deleted),
        JSON.stringify(deleted),
        document,
      ),
      c.env.DB.prepare(
        `INSERT INTO chapter (id,title,description,sort_order,icon,presentation,status)
        SELECT json_extract(value,'$.id'),json_extract(value,'$.title'),json_extract(value,'$.description'),json_extract(value,'$.sortOrder'),json_extract(value,'$.icon'),COALESCE(json_extract(value,'$.presentation'),'{}'),CASE WHEN json_extract(value,'$.archived') THEN 'archived' ELSE 'published' END FROM json_each(?,'$.chapters') WHERE ${guard}
        ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,sort_order=excluded.sort_order,icon=excluded.icon,presentation=excluded.presentation,status=excluded.status`,
      ).bind(document, operation),
      c.env.DB.prepare(
        `INSERT INTO course_quest_deletion (id,snapshot,actor_id,deleted_at,revision)
        SELECT id,json_object('id',id,'chapterId',chapter_id,'definition',json(definition),'archived',archived,'rewardLabel',reward_label,'rewardVersion',reward_version),?,?,?
        FROM quest WHERE id IN (SELECT value FROM json_each(?)) AND ${guard}`,
      ).bind(actor, now, input.expectedRevision + 1, JSON.stringify(deleted), operation),
      c.env.DB.prepare(
        `DELETE FROM quest WHERE id IN (SELECT value FROM json_each(?)) AND ${guard}`,
      ).bind(JSON.stringify(deleted), operation),
      c.env.DB.prepare(
        `INSERT INTO quest (id,chapter_id,definition,archived)
        SELECT json_extract(value,'$.id'),json_extract(value,'$.chapterId'),json_remove(value,'$.archived'),json_extract(value,'$.archived') FROM json_each(?,'$.quests') WHERE ${guard}
        ON CONFLICT(id) DO UPDATE SET chapter_id=excluded.chapter_id,definition=excluded.definition,archived=excluded.archived`,
      ).bind(document, operation),
      c.env.DB.prepare(
        `INSERT INTO course_change (revision,actor_id,saved_at,reason,document,request_key,request_hash) SELECT revision,?,?,?,?,?,? FROM course_revision WHERE id='current' AND operation_id=?`,
      ).bind(actor, now, input.reason, document, key, hash, operation),
    ]);
    if (results[0]?.meta.changes !== 1 && !(await replay())) {
      if (!(await canEdit(c.env, actor)))
        throw new AccessError('FORBIDDEN', '编辑权限已被撤销。', 403);
      const current = await editorSnapshot(c.env);
      if (current.revision !== input.expectedRevision)
        throw new AccessError('STALE_COURSE', '课程已被他人修改，请重新加载后核对。', 409);
      if (deleted.some((id) => current.protectedQuestIds.includes(id)))
        throw new AccessError(
          'DELETE_BLOCKED',
          '任务刚产生学习、考核或奖励记录，请撤销删除并使用归档。',
          409,
        );
      throw new AccessError(
        'LEARNING_RULE_LOCKED',
        '已有学习记录的任务不能直接修改前置或考核要求，请新增任务并归档旧任务。',
        409,
      );
    }
    return c.json(await editorSnapshot(c.env));
  });
