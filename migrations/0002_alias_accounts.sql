-- D1-safe parent-table rebuild: preserve children before DROP to avoid ON DELETE CASCADE.

-- All old sessions are intentionally revoked. Stable user IDs and progress are preserved.

PRAGMA defer_foreign_keys=ON;

CREATE TABLE __keep_account AS SELECT * FROM account;

CREATE TABLE __keep_progress AS SELECT * FROM progress;

DROP TABLE account;

DROP TABLE progress;

DROP TABLE session;

CREATE TABLE `__new_user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`login_alias` text,
	`account_state` text DEFAULT 'pending' NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`role` text DEFAULT 'member' NOT NULL
);

INSERT INTO __new_user (id,name,email,login_alias,account_state,email_verified,image,created_at,updated_at,role)
 SELECT id,name,email,NULL,'pending',email_verified,image,created_at,updated_at,role FROM user;

DROP TABLE user;

ALTER TABLE __new_user RENAME TO user;

CREATE UNIQUE INDEX user_email_unique ON user (email);

CREATE UNIQUE INDEX user_login_alias_unique ON user (login_alias);

CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `account_user_idx` ON `account` (`user_id`);

CREATE UNIQUE INDEX `account_identity_idx` ON `account` (`provider_id`,`account_id`);

CREATE TABLE `progress` (
	`user_id` text NOT NULL,
	`quest_id` text NOT NULL,
	`learning_status` text NOT NULL,
	`reward_status` text DEFAULT 'not_earned' NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `quest_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`quest_id`) REFERENCES `quest`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);

CREATE INDEX `session_user_idx` ON `session` (`user_id`);

INSERT INTO account SELECT * FROM __keep_account;

INSERT INTO progress SELECT * FROM __keep_progress;

DROP TABLE __keep_account;

DROP TABLE __keep_progress;

CREATE TABLE `account_claim` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`purpose` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`created_by` text,
	`used_at` integer,
	`revoked_at` integer,
	`redemption_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE UNIQUE INDEX `account_claim_token_hash_unique` ON `account_claim` (`token_hash`);
CREATE INDEX `claim_user_idx` ON `account_claim` (`user_id`);
CREATE TABLE `audit_event` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text,
	`target_id` text NOT NULL,
	`action` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE INDEX `audit_target_idx` ON `audit_event` (`target_id`);


PRAGMA defer_foreign_keys=OFF;
