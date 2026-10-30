CREATE TABLE `assessment_attempt` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`quest_id` text NOT NULL,
	`number` integer NOT NULL,
	`requested_at` integer NOT NULL,
	`requested_by` text NOT NULL,
	`member_note` text DEFAULT '' NOT NULL,
	`state` text NOT NULL,
	`request_key` text NOT NULL,
	`request_hash` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`quest_id`) REFERENCES `quest`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`,`quest_id`) REFERENCES `progress`(`user_id`,`quest_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_attempt_request_key_unique` ON `assessment_attempt` (`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `attempt_number_unique` ON `assessment_attempt` (`user_id`,`quest_id`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `attempt_pending_unique` ON `assessment_attempt` (`user_id`,`quest_id`) WHERE "assessment_attempt"."state" = 'pending';--> statement-breakpoint
CREATE TABLE `assessment_review` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`reviewer_id` text NOT NULL,
	`decision` text NOT NULL,
	`feedback` text NOT NULL,
	`assessed_at` integer NOT NULL,
	`reviewed_at` integer NOT NULL,
	`reward_label` text,
	`request_key` text NOT NULL,
	`request_hash` text NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `assessment_attempt`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewer_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_review_attempt_id_unique` ON `assessment_review` (`attempt_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `assessment_review_request_key_unique` ON `assessment_review` (`request_key`);--> statement-breakpoint
CREATE TABLE `reward_grant` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`quest_id` text NOT NULL,
	`review_id` text NOT NULL,
	`label` text NOT NULL,
	`status` text NOT NULL,
	`granted_at` integer NOT NULL,
	`granted_by` text NOT NULL,
	`delivered_at` integer,
	`delivered_by` text,
	`delivery_note` text DEFAULT '' NOT NULL,
	`delivery_key` text,
	`delivery_hash` text,
	`delivery_operation_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`quest_id`) REFERENCES `quest`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`review_id`) REFERENCES `assessment_review`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`granted_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`delivered_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`,`quest_id`) REFERENCES `progress`(`user_id`,`quest_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reward_grant_review_id_unique` ON `reward_grant` (`review_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `reward_grant_delivery_key_unique` ON `reward_grant` (`delivery_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `reward_owner_unique` ON `reward_grant` (`user_id`,`quest_id`);--> statement-breakpoint
ALTER TABLE `progress` ADD `version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `progress` ADD `operation_id` text;--> statement-breakpoint
ALTER TABLE `quest` ADD `reward_label` text;--> statement-breakpoint
ALTER TABLE `quest` ADD `reward_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `quest` ADD `reward_operation_id` text;