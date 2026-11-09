UPDATE `facility_notes` SET `text` = substr(`date`, 9, 2) || '.' || substr(`date`, 6, 2) || '.' || substr(`date`, 1, 4) || ': ' || `text` WHERE `kind` = 'day' AND `date` IS NOT NULL;--> statement-breakpoint
DROP INDEX `facility_notes_facility_kind_date`;--> statement-breakpoint
CREATE INDEX `facility_notes_facility` ON `facility_notes` (`facility_id`);--> statement-breakpoint
ALTER TABLE `facility_notes` DROP COLUMN `kind`;--> statement-breakpoint
ALTER TABLE `facility_notes` DROP COLUMN `date`;