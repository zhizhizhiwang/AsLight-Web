import assert from 'node:assert/strict';
import test from 'node:test';
import {
  connectCourseTasks,
  duplicateCourseTasks,
  moveCourseItems,
} from '../src/client/course-editing.ts';
import type { CourseDocument } from '../src/shared/editor.ts';

function fixture(): CourseDocument {
  return {
    chapters: [
      { id: 'one', title: '第一章', description: '', sortOrder: 0, icon: null, archived: false },
      { id: 'two', title: '第二章', description: '', sortOrder: 1, icon: null, archived: false },
    ],
    quests: [
      {
        id: 'a',
        chapterId: 'one',
        title: '主线1',
        summary: '任务内容待添加',
        kind: 'main',
        position: { x: 0, y: 0 },
        prerequisites: [],
        prerequisiteMode: 'all',
        archived: false,
      },
      {
        id: 'b',
        chapterId: 'two',
        title: '支线1',
        summary: '任务内容待添加',
        kind: 'side',
        position: { x: 200, y: 100 },
        prerequisites: ['a'],
        prerequisiteMode: 'any',
        archived: false,
      },
      {
        id: 'c',
        chapterId: 'two',
        title: '主线2',
        summary: '任务内容待添加',
        kind: 'main',
        position: { x: 400, y: 0 },
        prerequisites: ['b'],
        prerequisiteMode: 'all',
        archived: false,
      },
    ],
  };
}
test('canvas dependency edits keep branch modes and reject self, cycles, duplicates and archived references', () => {
  const original = fixture(),
    next = connectCourseTasks(original, 'a', 'c');
  assert.deepEqual(next.quests[2]?.prerequisites, ['b', 'a']);
  assert.equal(next.quests[1]?.prerequisiteMode, 'any');
  assert.equal(connectCourseTasks(original, 'a', 'b'), original);
  assert.throws(() => connectCourseTasks(original, 'c', 'a'), /循环/);
  assert.throws(() => connectCourseTasks(original, 'a', 'a'), /自己/);
  original.chapters[1]!.archived = true;
  assert.throws(() => connectCourseTasks(original, 'a', 'c'), /归档/);
  assert.throws(() => connectCourseTasks(original, 'missing', 'a'), /可用/);
});
test('group movement changes only coordinates, keeps IDs and rejects an entire invalid move', () => {
  const original = fixture(),
    before = structuredClone(original);
  const next = moveCourseItems(original, [
    { id: 'a', position: { x: 25.1, y: 30.9 } },
    { id: 'b', position: { x: 225, y: 131 } },
  ]);
  assert.deepEqual(
    next.quests.map((q) => q.position),
    [
      { x: 25, y: 31 },
      { x: 225, y: 131 },
      { x: 400, y: 0 },
    ],
  );
  assert.deepEqual(
    next.quests.map((q) => [q.id, q.prerequisites, q.prerequisiteMode]),
    original.quests.map((q) => [q.id, q.prerequisites, q.prerequisiteMode]),
  );
  assert.throws(
    () =>
      moveCourseItems(original, [
        { id: 'a', position: { x: 10, y: 10 } },
        { id: 'b', position: { x: 100001, y: 0 } },
      ]),
    /范围/,
  );
  assert.throws(() => moveCourseItems(original, [{ id: 'a', position: { x: NaN, y: 0 } }]), /范围/);
  assert.deepEqual(original, before);
});
test('copying a group assigns new stable IDs, remaps internal edges, retains external prerequisites and leaves originals intact', () => {
  const original = fixture(),
    before = structuredClone(original);
  let n = 0;
  const next = duplicateCourseTasks(original, ['b', 'c'], () => `copy-${++n}`);
  assert.deepEqual(next.ids, ['copy-1', 'copy-2']);
  assert.deepEqual(next.document.quests.slice(0, 3), before.quests);
  assert.deepEqual(next.document.quests[3]?.prerequisites, ['a']);
  assert.deepEqual(next.document.quests[4]?.prerequisites, ['copy-1']);
  assert.equal(next.document.quests[3]?.prerequisiteMode, 'any');
  assert.deepEqual(next.document.quests[3]?.position, { x: 240, y: 140 });
  assert.deepEqual(original, before);
});
