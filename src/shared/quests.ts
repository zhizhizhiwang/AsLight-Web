import { z } from 'zod';
import { chapterPresentationSchema, contentBlocksSchema, courseAssetSchema } from './content.ts';
import type { ChapterPresentation, ContentBlock } from './content.ts';
import { imageReferenceSchema } from './content.ts';

export type QuestKind = 'main' | 'side';
export type PrerequisiteMode = 'all' | 'any';

export interface Quest {
  id: string;
  chapterId: string;
  title: string;
  summary: string;
  rewardLabel?: string | undefined;
  rewardVersion?: number | undefined;
  kind: QuestKind;
  prerequisites: string[];
  prerequisiteMode: PrerequisiteMode;
  position: { x: number; y: number };
  imageAssetId?: string | undefined;
  content?: ContentBlock[] | undefined;
  assessmentContent?: ContentBlock[] | undefined;
}

export interface QuestMap {
  mode: 'demo' | 'placeholder';
  chapter: {
    id: string;
    title: string;
    description: string;
    presentation?: ChapterPresentation | undefined;
  };
  quests: Quest[];
}
export const questDefinitionSchema = z.object({
  id: z.string().min(1),
  chapterId: z.string().min(1),
  title: z.string(),
  summary: z.string(),
  kind: z.enum(['main', 'side']),
  prerequisites: z.array(z.string()),
  prerequisiteMode: z.enum(['all', 'any']),
  position: z.object({ x: z.number(), y: z.number() }),
  imageAssetId: imageReferenceSchema.optional(),
  content: contentBlocksSchema.optional(),
  assessmentContent: contentBlocksSchema.optional(),
});
const questSchema = questDefinitionSchema.extend({
  rewardLabel: z.string().optional(),
  rewardVersion: z.number().optional(),
});
export const questMapSchema: z.ZodType<QuestMap> = z.object({
  mode: z.enum(['demo', 'placeholder']),
  chapter: z.object({ id: z.string(), title: z.string(), description: z.string() }),
  quests: z.array(questSchema),
});

export const chapterSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  description: z.string(),
  sortOrder: z.number().int(),
  icon: z.string().nullable(),
  presentation: chapterPresentationSchema.optional(),
});
export type Chapter = z.infer<typeof chapterSchema>;
export const courseMapSchema = z.object({
  mode: z.literal('placeholder'),
  revision: z.number().int().nonnegative(),
  chapters: z.array(chapterSchema),
  quests: z.array(questSchema),
  assets: z.array(courseAssetSchema),
});
export type CourseMap = z.infer<typeof courseMapSchema>;

// Learning and reward delivery are independent; neither grants the other.
export type LearningStatus =
  'not_started' | 'in_progress' | 'submitted' | 'needs_revision' | 'passed';
export type RewardStatus = 'not_earned' | 'pending' | 'delivered' | 'not_applicable';
