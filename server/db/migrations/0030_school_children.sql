ALTER TABLE `child_group_changes` ADD `new_contract` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `children` ADD `contract_review_since` text;--> statement-breakpoint
ALTER TABLE `document_types` ADD `care_contract` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `facilities` ADD `auto_leave_school_children` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `groups` ADD `for_school_children` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- The document type "Betreuungsvertrag" of every facility is its care contract type (new facilities: DEFAULT_DOCUMENT_TYPES).
UPDATE `document_types` SET `care_contract` = 1 WHERE `name` = 'Betreuungsvertrag';