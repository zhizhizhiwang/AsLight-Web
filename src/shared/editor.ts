import { z } from 'zod';
import { chapterSchema, questDefinitionSchema } from './quests.ts';
import { courseAssetSchema } from './content.ts';

export const MAX_COURSE_BYTES = 256 * 1024;
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/);
export const editableChapterSchema = chapterSchema
  .extend({
    id,
    title: z.string().trim().min(1).max(120),
    description: z.string().max(5000),
    sortOrder: z.number().int().min(-100000).max(100000),
    icon: z.string().max(20).nullable(),
    archived: z.boolean(),
  })
  .strict();
export const editableQuestSchema = questDefinitionSchema
  .extend({
    id,
    chapterId: id,
    title: z.string().trim().min(1).max(120),
    summary: z.string().max(10000),
    position: z.strictObject({
      x: z.number().min(-100000).max(100000),
      y: z.number().min(-100000).max(100000),
    }),
    archived: z.boolean(),
  })
  .strict();
export const courseDocumentSchema = z.strictObject({
  chapters: z.array(editableChapterSchema).max(200),
  quests: z.array(editableQuestSchema).max(1000),
});
export type CourseDocument = z.infer<typeof courseDocumentSchema>;
export type EditableChapter = z.infer<typeof editableChapterSchema>;
export type EditableQuest = z.infer<typeof editableQuestSchema>;
export const saveCourseSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  requestId: z.uuid(),
  reason: z.string().trim().min(1).max(300),
  document: courseDocumentSchema,
  deletedQuestIds: z
    .array(id)
    .max(1000)
    .refine((ids) => new Set(ids).size === ids.length)
    .optional(),
});
export const contentAccessSchema = z.object({ canEdit: z.boolean() });
export const editorSnapshotSchema = z.object({
  revision: z.number().int().nonnegative(),
  updatedAt: z.number().nullable(),
  updatedBy: z.string().nullable(),
  document: courseDocumentSchema,
  assets: z.array(courseAssetSchema),
  protectedQuestIds: z.array(id),
});
export type EditorSnapshot = z.infer<typeof editorSnapshotSchema>;
export const permissionInputSchema = z.strictObject({
  canEdit: z.boolean(),
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).max(200),
});
