ALTER TABLE `children` ADD `consent_signal_photos` integer;--> statement-breakpoint
ALTER TABLE `children` ADD `consent_insect_repellent` integer;--> statement-breakpoint
UPDATE `children` SET `consent_whatsapp_photos` = CASE WHEN `consent_whatsapp_photos` IS NULL THEN `consent_photos_whatsapp` WHEN `consent_photos_whatsapp` IS NULL THEN `consent_whatsapp_photos` WHEN `consent_whatsapp_photos` = 0 OR `consent_photos_whatsapp` = 0 THEN 0 ELSE 1 END;--> statement-breakpoint
ALTER TABLE `children` DROP COLUMN `consent_photos_whatsapp`;