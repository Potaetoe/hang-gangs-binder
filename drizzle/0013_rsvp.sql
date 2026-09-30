-- Event RSVPs (owner rulings 2026-09-30): one "interested" row per
-- member per event, no timestamp; members see the count, admins the
-- names. events.rsvp_until is the admin-picked last RSVP day (null =
-- the event's own day). Purely additive - the previous code runs on
-- this schema untouched, so a code rollback stays safe.
CREATE TABLE `event_rsvps` (
	`event_id` text NOT NULL,
	`member_id` text NOT NULL,
	PRIMARY KEY(`event_id`, `member_id`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `event_rsvps_member` ON `event_rsvps` (`member_id`);--> statement-breakpoint
ALTER TABLE `events` ADD `rsvp_until` text;