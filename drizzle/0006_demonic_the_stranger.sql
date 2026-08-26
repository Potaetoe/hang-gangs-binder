CREATE TABLE `event_image_chunks` (
	`image_id` text NOT NULL,
	`seq` integer NOT NULL,
	`bytes` blob NOT NULL,
	PRIMARY KEY(`image_id`, `seq`)
);
--> statement-breakpoint
CREATE TABLE `event_images` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`position` integer NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `event_images_event` ON `event_images` (`event_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`title` text NOT NULL,
	`place` text,
	`notes` text
);
--> statement-breakpoint
CREATE INDEX `events_date` ON `events` (`date`);