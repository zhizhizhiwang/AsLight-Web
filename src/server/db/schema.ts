import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  foreignKey,
  check,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const storageMonitor = sqliteTable('storage_monitor', {
  id: text('id').primaryKey(),
  snapshot: text('snapshot'),
  progress: text('progress'),
  lease: text('lease'),
  leaseUntil: integer('lease_until').notNull().default(0),
  attemptedAt: integer('attempted_at').notNull().default(0),
  error: text('error'),
});
export const storageAlert = sqliteTable(
  'storage_alert',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    message: text('message').notNull(),
    openedAt: integer('opened_at').notNull(),
    resolvedAt: integer('resolved_at'),
  },
  (t) => [
    uniqueIndex('storage_alert_open')
      .on(t.kind)
      .where(sql`${t.resolvedAt} IS NULL`),
  ],
);

export const video = sqliteTable(
  'video',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    questId: text('quest_id')
      .notNull()
      .references(() => quest.id),
    attemptId: text('attempt_id')
      .unique()
      .references(() => assessmentAttempt.id),
    objectKey: text('object_key').notNull().unique(),
    objectVersion: text('object_version'),
    size: integer('size').notNull(),
    mimeType: text('mime_type').notNull(),
    status: text('status', { enum: ['uploading', 'ready', 'deleting', 'delete_failed', 'deleted'] })
      .notNull()
      .default('uploading'),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    uploadedAt: integer('uploaded_at'),
    deleteRequestedAt: integer('delete_requested_at'),
    deletedAt: integer('deleted_at'),
    lastCleanupAt: integer('last_cleanup_at'),
    deletedBy: text('deleted_by').references(() => user.id),
    deleteReason: text('delete_reason'),
  },
  (t) => [
    index('video_cleanup').on(t.status, t.createdAt),
    index('video_owner').on(t.userId, t.questId),
    check('video_size', sql`${t.size}>0 AND ${t.size}<=104857600`),
    check(
      'video_status',
      sql`${t.status} IN ('uploading','ready','deleting','delete_failed','deleted')`,
    ),
  ],
);

// Better Auth 1.7.14 core schema. Property names match the adapter contract.
export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  // Legacy email may be retained, but new accounts genuinely have no email.
  email: text('email').unique(),
  loginAlias: text('login_alias').unique(),
  credentialVersion: integer('credential_version').notNull().default(0),
  accountState: text('account_state', { enum: ['pending', 'active'] })
    .notNull()
    .default('pending'),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  role: text('role', { enum: ['member', 'admin'] })
    .notNull()
    .default('member'),
});
export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    credentialVersion: integer('credential_version').notNull().default(0),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [index('session_user_idx').on(t.userId)],
);
export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
    scope: text('scope'),
    password: text('password'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('account_user_idx').on(t.userId),
    uniqueIndex('account_identity_idx').on(t.providerId, t.accountId),
  ],
);
export const verification = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);
export const invitation = sqliteTable('invitation', {
  email: text('email').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: integer('expires_at').notNull(),
});
// Legacy invitation/local-mail tables remain only to avoid deleting old data.
// No active endpoint reads or writes them.
export const accountClaim = sqliteTable(
  'account_claim',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    tokenHash: text('token_hash').notNull().unique(),
    purpose: text('purpose', { enum: ['activate', 'reset'] }).notNull(),
    expiresAt: integer('expires_at').notNull(),
    createdAt: integer('created_at').notNull(),
    createdBy: text('created_by').references(() => user.id),
    usedAt: integer('used_at'),
    revokedAt: integer('revoked_at'),
    redemptionId: text('redemption_id'),
  },
  (t) => [index('claim_user_idx').on(t.userId)],
);
export const auditEvent = sqliteTable(
  'audit_event',
  {
    id: text('id').primaryKey(),
    actorId: text('actor_id').references(() => user.id),
    targetId: text('target_id')
      .notNull()
      .references(() => user.id),
    action: text('action').notNull(),
    reason: text('reason').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('audit_target_idx').on(t.targetId)],
);
export const throttle = sqliteTable('throttle', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  startsAt: integer('starts_at').notNull(),
});
export const localMail = sqliteTable('local_mail', {
  id: text('id').primaryKey(),
  recipient: text('recipient').notNull(),
  subject: text('subject').notNull(),
  url: text('url').notNull(),
  createdAt: integer('created_at').notNull(),
});
export const chapter = sqliteTable('chapter', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  icon: text('icon'),
  presentation: text('presentation').notNull().default('{}'),
  status: text('status', { enum: ['draft', 'published', 'archived'] })
    .notNull()
    .default('published'),
});
export const courseAsset = sqliteTable('course_asset', {
  id: text('id').primaryKey(),
  path: text('path').notNull(),
  alt: text('alt').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  status: text('status', { enum: ['draft', 'published', 'archived'] })
    .notNull()
    .default('draft'),
});
export const contentPermission = sqliteTable('content_permission', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id),
  canEdit: integer('can_edit', { mode: 'boolean' }).notNull().default(false),
  version: integer('version').notNull().default(0),
  operationId: text('operation_id'),
});
export const courseRevision = sqliteTable('course_revision', {
  id: text('id').primaryKey(),
  revision: integer('revision').notNull().default(0),
  updatedAt: integer('updated_at'),
  updatedBy: text('updated_by').references(() => user.id),
  operationId: text('operation_id'),
});
export const courseChange = sqliteTable('course_change', {
  revision: integer('revision').primaryKey(),
  actorId: text('actor_id')
    .notNull()
    .references(() => user.id),
  savedAt: integer('saved_at').notNull(),
  reason: text('reason').notNull(),
  document: text('document').notNull(),
  requestKey: text('request_key').notNull().unique(),
  requestHash: text('request_hash').notNull(),
});
export const quest = sqliteTable('quest', {
  id: text('id').primaryKey(),
  chapterId: text('chapter_id')
    .notNull()
    .references(() => chapter.id),
  definition: text('definition').notNull(),
  rewardLabel: text('reward_label'),
  rewardVersion: integer('reward_version').notNull().default(0),
  rewardOperationId: text('reward_operation_id'),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
});
export const courseQuestDeletion = sqliteTable('course_quest_deletion', {
  id: text('id').primaryKey(),
  snapshot: text('snapshot').notNull(),
  actorId: text('actor_id')
    .notNull()
    .references(() => user.id),
  deletedAt: integer('deleted_at').notNull(),
  revision: integer('revision').notNull(),
});
export const progress = sqliteTable(
  'progress',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    questId: text('quest_id')
      .notNull()
      .references(() => quest.id),
    learningStatus: text('learning_status', {
      enum: ['in_progress', 'submitted', 'needs_revision', 'passed'],
    }).notNull(),
    rewardStatus: text('reward_status', {
      enum: ['not_earned', 'pending', 'delivered', 'not_applicable'],
    })
      .notNull()
      .default('not_earned'),
    updatedAt: integer('updated_at').notNull(),
    version: integer('version').notNull().default(0),
    operationId: text('operation_id'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.questId] })],
);

export const assessmentAttempt = sqliteTable(
  'assessment_attempt',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    questId: text('quest_id')
      .notNull()
      .references(() => quest.id),
    number: integer('number').notNull(),
    requestedAt: integer('requested_at').notNull(),
    requestedBy: text('requested_by')
      .notNull()
      .references(() => user.id),
    memberNote: text('member_note').notNull().default(''),
    state: text('state', { enum: ['pending', 'reviewed'] }).notNull(),
    requestKey: text('request_key').notNull().unique(),
    requestHash: text('request_hash').notNull(),
  },
  (t) => [
    uniqueIndex('attempt_number_unique').on(t.userId, t.questId, t.number),
    uniqueIndex('attempt_pending_unique')
      .on(t.userId, t.questId)
      .where(sql`${t.state} = 'pending'`),
    foreignKey({
      columns: [t.userId, t.questId],
      foreignColumns: [progress.userId, progress.questId],
    }),
  ],
);
export const assessmentReview = sqliteTable('assessment_review', {
  id: text('id').primaryKey(),
  attemptId: text('attempt_id')
    .notNull()
    .unique()
    .references(() => assessmentAttempt.id),
  reviewerId: text('reviewer_id')
    .notNull()
    .references(() => user.id),
  decision: text('decision', { enum: ['passed', 'needs_revision'] }).notNull(),
  feedback: text('feedback').notNull(),
  assessedAt: integer('assessed_at').notNull(),
  reviewedAt: integer('reviewed_at').notNull(),
  rewardLabel: text('reward_label'),
  requestKey: text('request_key').notNull().unique(),
  requestHash: text('request_hash').notNull(),
});
export const rewardGrant = sqliteTable(
  'reward_grant',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    questId: text('quest_id')
      .notNull()
      .references(() => quest.id),
    reviewId: text('review_id')
      .notNull()
      .unique()
      .references(() => assessmentReview.id),
    label: text('label').notNull(),
    status: text('status', { enum: ['pending', 'delivered'] }).notNull(),
    grantedAt: integer('granted_at').notNull(),
    grantedBy: text('granted_by')
      .notNull()
      .references(() => user.id),
    deliveredAt: integer('delivered_at'),
    deliveredBy: text('delivered_by').references(() => user.id),
    deliveryNote: text('delivery_note').notNull().default(''),
    deliveryKey: text('delivery_key').unique(),
    deliveryHash: text('delivery_hash'),
    deliveryOperationId: text('delivery_operation_id'),
  },
  (t) => [
    uniqueIndex('reward_owner_unique').on(t.userId, t.questId),
    foreignKey({
      columns: [t.userId, t.questId],
      foreignColumns: [progress.userId, progress.questId],
    }),
  ],
);
