-- Hand-adjusted for D1 (hardening pass, 2026-08-26): D1 refuses
-- PRAGMA foreign_keys, and its own tool for rebuild migrations is
-- defer_foreign_keys - checks wait until this migration's transaction
-- commits, by which point every table is consistent again.
PRAGMA defer_foreign_keys = on;--> statement-breakpoint
CREATE TABLE `__new_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`date` text NOT NULL,
	`seq` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_entries`("id", "member_id", "date", "seq") SELECT "id", "member_id", "date", "seq" FROM `entries`;--> statement-breakpoint
DROP TABLE `entries`;--> statement-breakpoint
ALTER TABLE `__new_entries` RENAME TO `entries`;--> statement-breakpoint
CREATE INDEX `entries_member_date` ON `entries` (`member_id`,`date`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `entries_member_seq` ON `entries` (`member_id`,`seq`);--> statement-breakpoint
CREATE TABLE `__new_directory` (
	`member_id` text PRIMARY KEY NOT NULL,
	`sealed` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_directory`("member_id", "sealed", "updated_at") SELECT "member_id", "sealed", "updated_at" FROM `directory`;--> statement-breakpoint
DROP TABLE `directory`;--> statement-breakpoint
ALTER TABLE `__new_directory` RENAME TO `directory`;--> statement-breakpoint
CREATE TABLE `__new_entry_values` (
	`entry_id` text NOT NULL,
	`field_id` text NOT NULL,
	`metric` real,
	`imperial` real,
	`entered` text,
	`choice` text,
	PRIMARY KEY(`entry_id`, `field_id`),
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`field_id`) REFERENCES `fields`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_entry_values`("entry_id", "field_id", "metric", "imperial", "entered", "choice") SELECT "entry_id", "field_id", "metric", "imperial", "entered", "choice" FROM `entry_values`;--> statement-breakpoint
DROP TABLE `entry_values`;--> statement-breakpoint
ALTER TABLE `__new_entry_values` RENAME TO `entry_values`;--> statement-breakpoint
CREATE INDEX `entry_values_field` ON `entry_values` (`field_id`);--> statement-breakpoint
CREATE TABLE `__new_event_image_chunks` (
	`image_id` text NOT NULL,
	`seq` integer NOT NULL,
	`bytes` blob NOT NULL,
	PRIMARY KEY(`image_id`, `seq`),
	FOREIGN KEY (`image_id`) REFERENCES `event_images`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_event_image_chunks`("image_id", "seq", "bytes") SELECT "image_id", "seq", "bytes" FROM `event_image_chunks`;--> statement-breakpoint
DROP TABLE `event_image_chunks`;--> statement-breakpoint
ALTER TABLE `__new_event_image_chunks` RENAME TO `event_image_chunks`;--> statement-breakpoint
CREATE TABLE `__new_event_images` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`position` integer NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_event_images`("id", "event_id", "position", "mime", "size") SELECT "id", "event_id", "position", "mime", "size" FROM `event_images`;--> statement-breakpoint
DROP TABLE `event_images`;--> statement-breakpoint
ALTER TABLE `__new_event_images` RENAME TO `event_images`;--> statement-breakpoint
CREATE INDEX `event_images_event` ON `event_images` (`event_id`);--> statement-breakpoint
CREATE TABLE `__new_logins` (
	`lookup_hash` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`kind` text NOT NULL,
	`password_hash` text,
	`must_change` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_logins`("lookup_hash", "member_id", "kind", "password_hash", "must_change", "created_at") SELECT "lookup_hash", "member_id", "kind", "password_hash", "must_change", "created_at" FROM `logins`;--> statement-breakpoint
DROP TABLE `logins`;--> statement-breakpoint
ALTER TABLE `__new_logins` RENAME TO `logins`;--> statement-breakpoint
CREATE TABLE `__new_member_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`date` text NOT NULL,
	`action` text NOT NULL,
	`entry_id` text NOT NULL,
	`entry_date` text NOT NULL,
	`before` text NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_member_audit`("id", "member_id", "date", "action", "entry_id", "entry_date", "before") SELECT "id", "member_id", "date", "action", "entry_id", "entry_date", "before" FROM `member_audit`;--> statement-breakpoint
DROP TABLE `member_audit`;--> statement-breakpoint
ALTER TABLE `__new_member_audit` RENAME TO `member_audit`;--> statement-breakpoint
CREATE INDEX `member_audit_member` ON `member_audit` (`member_id`);--> statement-breakpoint
CREATE TABLE `__new_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_sessions`("token_hash", "member_id", "expires_at") SELECT "token_hash", "member_id", "expires_at" FROM `sessions`;--> statement-breakpoint
DROP TABLE `sessions`;--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;--> statement-breakpoint
CREATE TABLE `__new_socials` (
	`member_id` text PRIMARY KEY NOT NULL,
	`sealed` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_socials`("member_id", "sealed", "updated_at") SELECT "member_id", "sealed", "updated_at" FROM `socials`;--> statement-breakpoint
DROP TABLE `socials`;--> statement-breakpoint
ALTER TABLE `__new_socials` RENAME TO `socials`;