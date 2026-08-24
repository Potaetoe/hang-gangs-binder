CREATE TABLE `admin_log` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`subject_id` text,
	`detail` text
);
--> statement-breakpoint
CREATE INDEX `admin_log_date` ON `admin_log` (`date`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `logins` ADD `must_change` integer DEFAULT false NOT NULL;