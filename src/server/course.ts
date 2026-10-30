import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { validateQuestGraph, isQuestUnlocked } from './domain/quest-graph.ts';
import type { Bindings } from './bindings.ts';
import type { CourseMap } from '../shared/quests.ts';
import { questDefinitionSchema } from '../shared/quests.ts';
import {
  chapterPresentationSchema,
  contentAssetIds,
  courseAssetSchema,
} from '../shared/content.ts';
import type { QuestProgress } from '../shared/progress.ts';
import * as schema from './db/schema.ts';

export async function readCourse(env: Bindings) {
  const db = drizzle(env.DB);
  const [chapters, quests, assets, revisions] = await db.batch([
    db.select().from(schema.chapter).orderBy(asc(schema.chapter.sortOrder), asc(schema.chapter.id)),
    db.select().from(schema.quest),
    db.select().from(schema.courseAsset).where(eq(schema.courseAsset.status, 'published')),
    db
      .select({
        revision: schema.courseRevision.revision,
        updatedAt: schema.courseRevision.updatedAt,
        updatedBy: schema.user.name,
      })
      .from(schema.courseRevision)
      .leftJoin(schema.user, eq(schema.courseRevision.updatedBy, schema.user.id))
      .where(eq(schema.courseRevision.id, 'current')),
  ]);
  const revision = revisions[0];
  if (!revision) throw new Error('Course revision missing.');
  return { chapters, quests, assets, ...revision };
}

export async function loadMap(env: Bindings): Promise<CourseMap> {
  const snapshot = await readCourse(env);
  const chapterRows = snapshot.chapters.filter((row) => row.status === 'published');
  const chapters = chapterRows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    sortOrder: row.sortOrder,
    icon: row.icon,
    presentation: chapterPresentationSchema.parse(JSON.parse(row.presentation)),
  }));
  const rows = snapshot.quests.filter(
    (row) => !row.archived && chapters.some((chapter) => chapter.id === row.chapterId),
  );
  const quests = rows
    .map((row) => {
      const parsed = questDefinitionSchema.parse(JSON.parse(row.definition));
      if (parsed.id !== row.id || parsed.chapterId !== row.chapterId)
        throw new Error('Invalid quest identity.');
      return {
        ...parsed,
        rewardVersion: row.rewardVersion,
        ...(row.rewardLabel ? { rewardLabel: row.rewardLabel } : {}),
      };
    })
    .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
  validateQuestGraph(quests);
  const referenced = new Set<string>();
  for (const chapter of chapters) {
    const art = chapter.presentation;
    if (art.iconAssetId) referenced.add(art.iconAssetId);
    if (art.backgroundAssetId) referenced.add(art.backgroundAssetId);
    for (const item of art.decorations ?? [])
      if (item.type === 'image') referenced.add(item.assetId);
  }
  for (const quest of quests) {
    if (quest.imageAssetId) referenced.add(quest.imageAssetId);
    for (const id of [
      ...contentAssetIds(quest.content),
      ...contentAssetIds(quest.assessmentContent),
    ])
      referenced.add(id);
  }
  const assetRows = snapshot.assets;
  const assets = assetRows.flatMap(({ status: _status, ...row }) => {
    if (!referenced.has(row.id)) return [];
    const parsed = courseAssetSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
  return { mode: 'placeholder', revision: snapshot.revision, chapters, quests, assets };
}

export async function ownProgress(
  env: Bindings,
  userId: string,
  map: CourseMap,
): Promise<QuestProgress[]> {
  const rows = await drizzle(env.DB)
    .select()
    .from(schema.progress)
    .where(eq(schema.progress.userId, userId));
  const passed = new Set(
    rows.filter((row) => row.learningStatus === 'passed').map((row) => row.questId),
  );
  return map.quests.map((quest) => {
    const saved = rows.find((row) => row.questId === quest.id);
    return {
      questId: quest.id,
      learningStatus: saved?.learningStatus ?? 'not_started',
      rewardStatus: saved?.rewardStatus ?? 'not_earned',
      unlocked: isQuestUnlocked(quest, passed),
      updatedAt: saved?.updatedAt ?? null,
      version: saved?.version ?? 0,
    };
  });
}
