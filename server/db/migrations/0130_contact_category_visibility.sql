-- „Wer sieht sie?“ for the categories of „Kontakte“ and „Wer sieht ihn?“ for each contact, with the same three levels as
-- the print templates and „Wissen“ (shared/domain/contacts.ts). Every category gets 'all'; each contact's former
-- „auch für Mitarbeitende und am Tablet sichtbar“ becomes 'all' (ticked) or 'managers' (not ticked), so nobody sees more
-- or less than before. The old column is dropped afterwards.
ALTER TABLE `contact_categories` ADD `visibility` text DEFAULT 'all' NOT NULL;--> statement-breakpoint
ALTER TABLE `contacts` ADD `visibility` text DEFAULT 'all' NOT NULL;--> statement-breakpoint
UPDATE `contacts` SET `visibility` = CASE WHEN `visible_to_staff` = 1 THEN 'all' ELSE 'managers' END;--> statement-breakpoint
ALTER TABLE `contacts` DROP COLUMN `visible_to_staff`;
