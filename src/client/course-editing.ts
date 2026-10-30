import type { CourseDocument } from '../shared/editor.ts';

export type CanvasMove = { id: string; position: { x: number; y: number } };

export function taskDeletionReason(
  document: CourseDocument,
  id: string,
  protectedIds: readonly string[],
): string | null {
  if (!document.quests.some((q) => q.id === id)) return '任务不存在，请重新加载课程。';
  if (protectedIds.includes(id)) return '此任务已有学习、考核或奖励记录，请使用归档。';
  const reference = document.quests.find((q) => q.id !== id && q.prerequisites.includes(id));
  return reference ? `「${reference.title}」仍把此任务作为前置，请先移除这条关系。` : null;
}
export function removeCourseQuest(
  document: CourseDocument,
  id: string,
  protectedIds: readonly string[] = [],
): CourseDocument {
  const reason = taskDeletionReason(document, id, protectedIds);
  if (reason) throw new Error(reason);
  return { ...document, quests: document.quests.filter((q) => q.id !== id) };
}

export function moveCourseItems(document: CourseDocument, moves: CanvasMove[]): CourseDocument {
  if (
    moves.some(
      ({ position: p }) =>
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        Math.abs(p.x) > 100000 ||
        Math.abs(p.y) > 100000,
    )
  )
    throw new Error('移动超出画布范围，请缩小移动距离。');
  const positions = new Map(
    moves.map((m) => [m.id, { x: Math.round(m.position.x), y: Math.round(m.position.y) }]),
  );
  return {
    ...document,
    quests: document.quests.map((q) =>
      positions.has(q.id) ? { ...q, position: positions.get(q.id) ?? q.position } : q,
    ),
  };
}

export function connectCourseTasks(
  document: CourseDocument,
  source: string,
  target: string,
): CourseDocument {
  const enabled = new Set(document.chapters.filter((c) => !c.archived).map((c) => c.id));
  const tasks = new Map(
    document.quests.filter((q) => !q.archived && enabled.has(q.chapterId)).map((q) => [q.id, q]),
  );
  const from = tasks.get(source),
    to = tasks.get(target);
  if (!from || !to) throw new Error('请选择两个可用任务，归档内容不能建立前置关系。');
  if (source === target) throw new Error('任务不能把自己设为前置。');
  if (to.prerequisites.includes(source)) return document;
  const visited = new Set<string>();
  const reaches = (id: string): boolean => {
    if (id === target) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    return tasks.get(id)?.prerequisites.some(reaches) ?? false;
  };
  if (reaches(source)) throw new Error('这条连线会形成循环，请调整前置关系。');
  return {
    ...document,
    quests: document.quests.map((q) =>
      q.id === target ? { ...q, prerequisites: [...q.prerequisites, source] } : q,
    ),
  };
}

export function duplicateCourseTasks(
  document: CourseDocument,
  ids: string[],
  newId: () => string,
): { document: CourseDocument; ids: string[] } {
  const selected = document.quests.filter((q) => ids.includes(q.id) && !q.archived);
  if (document.quests.length + selected.length > 1000)
    throw new Error('任务数量已达上限，请先整理课程。');
  const remap = new Map(selected.map((q) => [q.id, newId()]));
  const copies = selected.map((q) => ({
    ...q,
    id: remap.get(q.id) ?? q.id,
    position: { x: q.position.x + 40, y: q.position.y + 40 },
    prerequisites: q.prerequisites.map((p) => remap.get(p) ?? p),
  }));
  if (copies.some((q) => Math.abs(q.position.x) > 100000 || Math.abs(q.position.y) > 100000))
    throw new Error('复制位置超出画布范围，请先移动原任务。');
  return {
    document: { ...document, quests: [...document.quests, ...copies] },
    ids: copies.map((q) => q.id),
  };
}
