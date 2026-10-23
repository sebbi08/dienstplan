ALTER TABLE `employees` ADD `pin_lock_level` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- PINs now have 6 digits: every old 4-digit PIN becomes invalid and must be set again by the Leitung or the Träger.
UPDATE `employees` SET `pin_hash` = NULL, `pin_failed` = 0, `pin_locked_until` = NULL, `pin_lock_level` = 0;
