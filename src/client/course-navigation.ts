import type { CourseMap } from '../shared/quests.ts';

export function courseLocation(course: CourseMap, params: URLSearchParams) {
  const chapterId = params.get('chapter');
  const questId = params.get('quest');
  const quest = course.quests.find((item) => item.id === questId);
  const chapter =
    chapterId !== null
      ? course.chapters.find((item) => item.id === chapterId)
      : (course.chapters.find((item) => item.id === quest?.chapterId) ?? course.chapters[0]);
  const issue =
    chapterId !== null && !chapter
      ? '该章节不存在或已归档，请从章节列表重新选择。'
      : questId !== null && (!quest || quest.chapterId !== chapter?.id)
        ? '该任务不属于当前章节，或已归档。请重新选择任务。'
        : '';
  return { chapter, quest: issue ? undefined : quest, issue };
}

export function courseSearch(params: URLSearchParams, chapterId: string | undefined) {
  const next = new URLSearchParams();
  if (chapterId !== undefined) next.set('chapter', chapterId);
  const kind = params.get('kind');
  if (kind === 'main' || kind === 'side') next.set('kind', kind);
  return next;
}
