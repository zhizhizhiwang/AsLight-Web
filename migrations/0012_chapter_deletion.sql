CREATE TABLE `course_chapter_deletion` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot` text NOT NULL,
	`actor_id` text NOT NULL,
	`deleted_at` integer NOT NULL,
	`revision` integer NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
