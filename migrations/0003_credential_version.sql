ALTER TABLE `session` ADD `credential_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `credential_version` integer DEFAULT 0 NOT NULL;