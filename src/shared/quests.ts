export type QuestKind = 'main' | 'side';
export type PrerequisiteMode = 'all' | 'any';

export interface Quest {
  id: string;
  chapterId: string;
  title: string;
  summary: string;
  kind: QuestKind;
  prerequisites: string[];
  prerequisiteMode: PrerequisiteMode;
  position: { x: number; y: number };
}

export interface QuestMap {
  mode: 'demo';
  chapter: { id: string; title: string; description: string };
  quests: Quest[];
}

// Progress and reward fulfillment are independent concepts. These are contracts,
// not persistence models; authentication and database migrations come in phase 1.
export type LearningStatus =
  'not_started' | 'in_progress' | 'submitted' | 'needs_revision' | 'passed';
export type RewardStatus = 'not_earned' | 'pending' | 'delivered' | 'not_applicable';
