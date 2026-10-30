CREATE TABLE `content_permission` (
	`user_id` text PRIMARY KEY NOT NULL,
	`can_edit` integer DEFAULT false NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`operation_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `course_change` (
	`revision` integer PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`saved_at` integer NOT NULL,
	`reason` text NOT NULL,
	`document` text NOT NULL,
	`request_key` text NOT NULL,
	`request_hash` text NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `course_change_request_key_unique` ON `course_change` (`request_key`);--> statement-breakpoint
CREATE TABLE `course_revision` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` integer,
	`updated_by` text,
	`operation_id` text,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `course_revision` (`id`, `revision`) VALUES ('current', 0);
