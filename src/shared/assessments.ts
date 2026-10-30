import { z } from 'zod';
import { questProgressSchema } from './progress.ts';
import { courseMapSchema } from './quests.ts';

export const requestAssessmentInput = z.strictObject({
  requestId: z.uuid(),
  expectedVersion: z.number().int().nonnegative(),
  note: z.string().trim().max(1000),
  videoId: z.uuid().optional(),
});
export const offlineReviewInput = z
  .strictObject({
    requestId: z.uuid(),
    expectedVersion: z.number().int().nonnegative(),
    expectedAttemptId: z.uuid().nullable(),
    decision: z.enum(['passed', 'needs_revision']),
    feedback: z.string().trim().max(2000),
    assessedAt: z
      .number()
      .int()
      .nonnegative()
      .refine((value) => value <= Date.now() + 300_000, '考核时间不能晚于现在。'),
  })
  .refine(
    (value) => value.decision !== 'needs_revision' || value.feedback.length > 0,
    '退回时请填写修改意见。',
  );
export const rewardDeliveryInput = z.strictObject({
  requestId: z.uuid(),
  note: z.string().trim().max(1000),
});
export const rewardSettingInput = z.strictObject({
  expectedVersion: z.number().int().nonnegative(),
  label: z.string().trim().min(1).max(200).nullable(),
});

export const assessmentRecordSchema = z.object({
  id: z.string(),
  questId: z.string(),
  number: z.number(),
  requestedAt: z.number(),
  requestedByName: z.string(),
  memberNote: z.string(),
  state: z.enum(['pending', 'reviewed']),
  review: z
    .object({
      id: z.string(),
      decision: z.enum(['passed', 'needs_revision']),
      feedback: z.string(),
      assessedAt: z.number(),
      reviewedAt: z.number(),
      reviewerName: z.string(),
      rewardLabel: z.string().nullable(),
    })
    .nullable(),
});
export const rewardRecordSchema = z.object({
  id: z.string(),
  questId: z.string(),
  label: z.string(),
  status: z.enum(['pending', 'delivered']),
  grantedAt: z.number(),
  deliveredAt: z.number().nullable(),
  deliveredByName: z.string().nullable(),
  deliveryNote: z.string(),
});
export const learningDetailSchema = z.object({
  assessments: z.array(assessmentRecordSchema),
  reward: rewardRecordSchema.nullable(),
  progress: questProgressSchema,
});
export type AssessmentRecord = z.infer<typeof assessmentRecordSchema>;
export type RewardRecord = z.infer<typeof rewardRecordSchema>;
export type LearningDetail = z.infer<typeof learningDetailSchema>;
export type OfflineReviewInput = z.infer<typeof offlineReviewInput>;
export const adminLearningViewSchema = z.object({
  member: z.object({ id: z.string(), name: z.string(), state: z.enum(['pending', 'active']) }),
  map: courseMapSchema,
  progress: z.array(questProgressSchema),
  assessments: z.array(assessmentRecordSchema),
  rewards: z.array(rewardRecordSchema),
});
export type AdminLearningView = z.infer<typeof adminLearningViewSchema>;
