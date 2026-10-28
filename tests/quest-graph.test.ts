import assert from 'node:assert/strict';
import test from 'node:test';
import { isQuestUnlocked, validateQuestGraph } from '../src/server/domain/quest-graph.ts';
import type { Quest } from '../src/shared/quests.ts';

function quest(
  id: string,
  prerequisites: string[] = [],
  prerequisiteMode: 'all' | 'any' = 'all',
): Quest {
  return {
    id,
    chapterId: 'test',
    title: id,
    summary: '',
    kind: 'main',
    prerequisites,
    prerequisiteMode,
    position: { x: 0, y: 0 },
  };
}

test('a task without prerequisites is available, including empty any', () => {
  assert.equal(isQuestUnlocked(quest('start'), new Set()), true);
  assert.equal(isQuestUnlocked(quest('start', [], 'any'), new Set()), true);
});
test('all prerequisites must pass; reward state is not an input', () => {
  const target = quest('target', ['a', 'b']);
  assert.equal(isQuestUnlocked(target, new Set(['a'])), false);
  assert.equal(isQuestUnlocked(target, new Set(['a', 'b'])), true);
});
test('any prerequisite can unlock a side task', () => {
  const target = { ...quest('target', ['a', 'b'], 'any'), kind: 'side' as const };
  assert.equal(isQuestUnlocked(target, new Set()), false);
  assert.equal(isQuestUnlocked(target, new Set(['b'])), true);
});
test('a branching DAG is valid regardless of display ordering', () => {
  assert.doesNotThrow(() =>
    validateQuestGraph([
      quest('end', ['a', 'b']),
      quest('b', ['start']),
      quest('start'),
      quest('a', ['start']),
    ]),
  );
});
test('duplicate task IDs and duplicate edges are rejected', () => {
  assert.throws(() => validateQuestGraph([quest('a'), quest('a')]), /duplicate quest/);
  assert.throws(
    () => validateQuestGraph([quest('a'), quest('b', ['a', 'a'])]),
    /Duplicate prerequisite/,
  );
});
test('missing prerequisites are rejected before publication', () => {
  assert.throws(() => validateQuestGraph([quest('a', ['missing'])]), /Unknown prerequisite/);
});
test('direct and indirect cycles are rejected even with any prerequisites', () => {
  assert.throws(() => validateQuestGraph([quest('a', ['a'])]), /Cyclic prerequisite/);
  assert.throws(
    () => validateQuestGraph([quest('a', ['b'], 'any'), quest('b', ['c']), quest('c', ['a'])]),
    /Cyclic prerequisite/,
  );
});
