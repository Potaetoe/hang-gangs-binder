-- Security pass, 2026-08-24: the date-only rule reaches the last four
-- tables that missed it. `members`, `logins` and `directory` carried
-- unix seconds beside a member id - an activity log precise enough to
-- line up against the group's chat, which is the exact correlation
-- DESIGN.md's date-only rule exists to prevent. The copies below
-- CONVERT rather than restring: date(col,'unixepoch') keeps the day
-- and throws the clock away, so a fork with real data is fixed by
-- running this, not just reshaped.
--
-- `sessions` keeps a real expiry because it has to enforce one, but
-- loses `created_at` entirely and gets its remaining timestamp rounded
-- up to a day boundary.
CREATE TABLE `used_logins` (
	`hash` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_directory` (
	`member_id` text PRIMARY KEY NOT NULL,
	`sealed` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_directory`("member_id", "sealed", "updated_at") SELECT "member_id", "sealed", date("updated_at", 'unixepoch') FROM `directory`;--> statement-breakpoint
DROP TABLE `directory`;--> statement-breakpoint
ALTER TABLE `__new_directory` RENAME TO `directory`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_logins` (
	`lookup_hash` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`kind` text NOT NULL,
	`password_hash` text,
	`must_change` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_logins`("lookup_hash", "member_id", "kind", "password_hash", "must_change", "created_at") SELECT "lookup_hash", "member_id", "kind", "password_hash", "must_change", date("created_at", 'unixepoch') FROM `logins`;--> statement-breakpoint
DROP TABLE `logins`;--> statement-breakpoint
ALTER TABLE `__new_logins` RENAME TO `logins`;--> statement-breakpoint
CREATE TABLE `__new_members` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`is_admin` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_members`("id", "status", "is_admin", "created_at") SELECT "id", "status", "is_admin", date("created_at", 'unixepoch') FROM `members`;--> statement-breakpoint
DROP TABLE `members`;--> statement-breakpoint
ALTER TABLE `__new_members` RENAME TO `members`;--> statement-breakpoint
ALTER TABLE `sessions` DROP COLUMN `created_at`;--> statement-breakpoint
UPDATE `sessions` SET `expires_at` = ((`expires_at` / 86400) + 1) * 86400;
