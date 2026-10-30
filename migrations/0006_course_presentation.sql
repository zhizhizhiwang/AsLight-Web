CREATE TABLE `course_asset` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`alt` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL
);
--> statement-breakpoint
ALTER TABLE `chapter` ADD `presentation` text DEFAULT '{}' NOT NULL;