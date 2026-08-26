-- Global sign-in backoff (2026-08-26, security review finding 9):
-- failure counts per account lookup hash, so the brake holds across
-- every edge. Success deletes a row; a quiet day decays it. The
-- blocked_until clock is deliberate - minute-scale backoff cannot be
-- day-granular - and it marks failed tries only.
CREATE TABLE `login_backoff` (
	`lookup_hash` text PRIMARY KEY NOT NULL,
	`fails` integer NOT NULL,
	`blocked_until` integer NOT NULL
);
