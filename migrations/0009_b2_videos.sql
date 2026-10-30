CREATE TABLE `video` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`quest_id` text NOT NULL,
	`attempt_id` text,
	`object_key` text NOT NULL,
	`object_version` text,
	`size` integer NOT NULL,
	`mime_type` text NOT NULL,
	`status` text DEFAULT 'uploading' NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`uploaded_at` integer,
	`delete_requested_at` integer,
	`deleted_at` integer,
	`last_cleanup_at` integer,
	`deleted_by` text,
	`delete_reason` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`quest_id`) REFERENCES `quest`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`attempt_id`) REFERENCES `assessment_attempt`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deleted_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "video_size" CHECK("video"."size">0 AND "video"."size"<=104857600),
	CONSTRAINT "video_status" CHECK("video"."status" IN ('uploading','ready','deleting','delete_failed','deleted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `video_attempt_id_unique` ON `video` (`attempt_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `video_object_key_unique` ON `video` (`object_key`);--> statement-breakpoint
CREATE INDEX `video_cleanup` ON `video` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `video_owner` ON `video` (`user_id`,`quest_id`);