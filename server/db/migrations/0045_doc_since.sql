ALTER TABLE `facilities` ADD `doc_since` text;--> statement-breakpoint
ALTER TABLE `groups` ADD `doc_since` text;--> statement-breakpoint
UPDATE `facilities` SET `doc_since` = date('now', 'localtime') WHERE `doc_mode` <> 'off';--> statement-breakpoint
UPDATE `groups` SET `doc_since` = date('now', 'localtime') WHERE `doc_mode` <> 'off';