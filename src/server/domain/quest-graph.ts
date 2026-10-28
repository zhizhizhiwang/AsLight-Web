import type { Quest } from '../../shared/quests.ts';

/** Validate the entire published catalog, including cross-chapter prerequisites. */
export function validateQuestGraph(quests: readonly Quest[]): void {
  const byId = new Map<string, Quest>();
  for (const quest of quests) {
    if (!quest.id || byId.has(quest.id)) throw new Error(`Invalid or duplicate quest: ${quest.id}`);
    byId.set(quest.id, quest);
  }

  for (const quest of quests) {
    if (new Set(quest.prerequisites).size !== quest.prerequisites.length) {
      throw new Error(`Duplicate prerequisite: ${quest.id}`);
    }
    for (const prerequisite of quest.prerequisites) {
      if (!byId.has(prerequisite)) throw new Error(`Unknown prerequisite: ${prerequisite}`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(id: string): void {
    if (visiting.has(id)) throw new Error(`Cyclic prerequisite: ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const prerequisite of byId.get(id)!.prerequisites) visit(prerequisite);
    visiting.delete(id);
    visited.add(id);
  }
  for (const quest of quests) visit(quest.id);
}

/** Only server-confirmed passes unlock tasks; reward pickup never gates learning. */
export function isQuestUnlocked(quest: Quest, passedQuestIds: ReadonlySet<string>): boolean {
  if (quest.prerequisites.length === 0) return true;
  const passed = (id: string) => passedQuestIds.has(id);
  return quest.prerequisiteMode === 'all'
    ? quest.prerequisites.every(passed)
    : quest.prerequisites.some(passed);
}
