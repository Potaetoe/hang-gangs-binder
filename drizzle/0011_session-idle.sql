-- Session hardening (2026-08-26): the idle clock, day-granular. A
-- session unused for 7 days dies; using it slides idle_expires_at to a
-- day boundary, never a clock reading. DEFAULT 0 leaves every existing
-- session idle-expired on arrival - harmless, because the same branch
-- renames the cookie to __Host-session, which signs everyone out
-- anyway; the sweep in sessionMember deletes the dead rows.
ALTER TABLE `sessions` ADD COLUMN `idle_expires_at` INTEGER NOT NULL DEFAULT 0;
