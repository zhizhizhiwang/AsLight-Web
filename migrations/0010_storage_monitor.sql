CREATE TABLE `storage_alert` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	`opened_at` integer NOT NULL,
	`resolved_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `storage_alert_open` ON `storage_alert` (`kind`) WHERE "storage_alert"."resolved_at" IS NULL;--> statement-breakpoint
CREATE TABLE `storage_monitor` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot` text,
	`progress` text,
	`lease` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`attempted_at` integer DEFAULT 0 NOT NULL,
	`error` text
);
