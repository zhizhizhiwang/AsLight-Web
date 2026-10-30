ALTER TABLE `chapter` ADD `sort_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `chapter` ADD `icon` text;--> statement-breakpoint
ALTER TABLE `chapter` ADD `status` text DEFAULT 'published' NOT NULL;