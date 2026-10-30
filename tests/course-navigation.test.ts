import assert from 'node:assert/strict';
import test from 'node:test';
import { courseLocation, courseSearch } from '../src/client/course-navigation.ts';
import type { CourseMap } from '../src/shared/quests.ts';

const course: CourseMap = {
  mode: 'placeholder',
  revision: 0,
  assets: [],
  chapters: ['first', 'second', 'empty'].map((id, sortOrder) => ({
    id,
    title: id,
    description: '',
    sortOrder,
    icon: null,
  })),
  quests: [
    {
      id: 'task',
      chapterId: 'second',
      title: '主线1',
      summary: '任务内容待添加',
      kind: 'main',
      prerequisites: [],
      prerequisiteMode: 'all',
      position: { x: 0, y: 0 },
    },
  ],
};

test('chapter URLs restore explicit chapters and legacy quest-only links', () => {
  assert.equal(courseLocation(course, new URLSearchParams()).chapter?.id, 'first');
  assert.equal(courseLocation(course, new URLSearchParams('chapter=empty')).chapter?.id, 'empty');
  const legacy = courseLocation(course, new URLSearchParams('quest=task&kind=main'));
  assert.equal(legacy.chapter?.id, 'second');
  assert.equal(legacy.quest?.id, 'task');
});

test('invalid or archived references and chapter/quest mismatches never silently open another task', () => {
  for (const query of [
    'chapter=removed',
    'quest=removed',
    'chapter=first&quest=task',
    'chapter=',
  ]) {
    const location = courseLocation(course, new URLSearchParams(query));
    assert.ok(location.issue);
    assert.equal(location.quest, undefined);
  }
  assert.equal(
    courseLocation({ ...course, chapters: [], quests: [] }, new URLSearchParams()).chapter,
    undefined,
  );
});

test('page/chapter navigation preserves valid filters and removes task and account parameters', () => {
  assert.equal(
    courseSearch(
      new URLSearchParams('chapter=first&kind=side&quest=old&mode=login'),
      'second',
    ).toString(),
    'chapter=second&kind=side',
  );
  assert.equal(courseSearch(new URLSearchParams('kind=invalid'), undefined).toString(), '');
});
