import { z } from 'zod';
import { courseMapSchema } from './quests.ts';

export const questProgressSchema = z.object({
  questId: z.string(),
  learningStatus: z.enum(['not_started', 'in_progress', 'submitted', 'needs_revision', 'passed']),
  rewardStatus: z.enum(['not_earned', 'pending', 'delivered', 'not_applicable']),
  unlocked: z.boolean(),
  updatedAt: z.number().nullable(),
  version: z.number().int().nonnegative(),
});
export type QuestProgress = z.infer<typeof questProgressSchema>;
export const memberMapSchema = z.object({
  map: courseMapSchema,
  progress: z.array(questProgressSchema).nullable(),
});
export type MemberMap = z.infer<typeof memberMapSchema>;
