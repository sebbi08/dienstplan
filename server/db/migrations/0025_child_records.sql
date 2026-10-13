CREATE TABLE `care_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer DEFAULT 1 NOT NULL,
	`name` text NOT NULL,
	`start` integer NOT NULL,
	`end` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `care_types_facility` ON `care_types` (`facility_id`);--> statement-breakpoint
CREATE TABLE `child_contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`child_id` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`name` text NOT NULL,
	`relation` text DEFAULT '' NOT NULL,
	`phone_home` text DEFAULT '' NOT NULL,
	`phone_mobile` text DEFAULT '' NOT NULL,
	`phone_work` text DEFAULT '' NOT NULL,
	`is_guardian` integer DEFAULT false NOT NULL,
	`may_pick_up` integer DEFAULT false NOT NULL,
	`contact_ban` integer DEFAULT false NOT NULL,
	`emergency_rank` integer,
	`contact_ban_note` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`child_id`) REFERENCES `children`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `child_contacts_child` ON `child_contacts` (`child_id`);--> statement-breakpoint
CREATE TABLE `child_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`child_id` integer NOT NULL,
	`document_type_id` integer NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`document_date` text,
	`confidential` integer DEFAULT false NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`data` blob NOT NULL,
	`uploaded_by` integer,
	`uploaded_at` text NOT NULL,
	FOREIGN KEY (`child_id`) REFERENCES `children`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_type_id`) REFERENCES `document_types`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `child_documents_child` ON `child_documents` (`child_id`);--> statement-breakpoint
CREATE TABLE `children` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer DEFAULT 1 NOT NULL,
	`group_id` integer,
	`care_type_id` integer,
	`last_name` text NOT NULL,
	`first_name` text NOT NULL,
	`birth_date` text NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`entry_date` text,
	`planned_entry_date` text,
	`info_meeting_date` text,
	`school_start_date` text,
	`primary_school` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`left_on` text,
	`measles_proof` integer,
	`measles_proof_date` text,
	`infection_briefing_date` text,
	`allergies` text DEFAULT '' NOT NULL,
	`may_take_temperature` integer,
	`may_apply_sunscreen` integer,
	`may_apply_plaster` integer,
	`consent_artwork_display` integer,
	`consent_photos_display` integer,
	`consent_photos_foreign_portfolios` integer,
	`consent_photos_internal_events` integer,
	`consent_photos_whatsapp` integer,
	`consent_photos_names_birthdays_display` integer,
	`consent_group_work_with_names` integer,
	`consent_whatsapp_contact` integer,
	`consent_whatsapp_photos` integer,
	`consent_whatsapp_parent_group` integer,
	`master_updated_at` text,
	`master_updated_by` integer,
	`contacts_updated_at` text,
	`contacts_updated_by` integer,
	`health_updated_at` text,
	`health_updated_by` integer,
	`consents_updated_at` text,
	`consents_updated_by` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`care_type_id`) REFERENCES `care_types`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`master_updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contacts_updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`health_updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`consents_updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `children_facility` ON `children` (`facility_id`);--> statement-breakpoint
CREATE INDEX `children_group` ON `children` (`group_id`);--> statement-breakpoint
CREATE TABLE `document_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer DEFAULT 1 NOT NULL,
	`name` text NOT NULL,
	`important` integer DEFAULT false NOT NULL,
	`required` integer DEFAULT false NOT NULL,
	`confidential_default` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `document_types_facility` ON `document_types` (`facility_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `can_edit_children` integer DEFAULT false NOT NULL;
--> statement-breakpoint
INSERT INTO `document_types` (`facility_id`, `name`, `important`, `required`, `confidential_default`, `sort_order`) SELECT `id`, 'Betreuungsvertrag', 1, 1, 1, 0 FROM `facilities`;
--> statement-breakpoint
INSERT INTO `document_types` (`facility_id`, `name`, `important`, `required`, `confidential_default`, `sort_order`) SELECT `id`, 'Masernnachweis', 1, 1, 0, 1 FROM `facilities`;
--> statement-breakpoint
INSERT INTO `document_types` (`facility_id`, `name`, `important`, `required`, `confidential_default`, `sort_order`) SELECT `id`, 'Belehrung Infektionsschutz', 1, 1, 0, 2 FROM `facilities`;
--> statement-breakpoint
INSERT INTO `document_types` (`facility_id`, `name`, `important`, `required`, `confidential_default`, `sort_order`) SELECT `id`, 'Datenschutz-Einwilligung', 1, 1, 0, 3 FROM `facilities`;
--> statement-breakpoint
INSERT INTO `document_types` (`facility_id`, `name`, `important`, `required`, `confidential_default`, `sort_order`) SELECT `id`, 'Sorgerechtsbeschluss', 1, 0, 1, 4 FROM `facilities`;
--> statement-breakpoint
INSERT INTO `document_types` (`facility_id`, `name`, `important`, `required`, `confidential_default`, `sort_order`) SELECT `id`, 'Ärztliches Attest', 0, 0, 1, 5 FROM `facilities`;
--> statement-breakpoint
INSERT INTO `document_types` (`facility_id`, `name`, `important`, `required`, `confidential_default`, `sort_order`) SELECT `id`, 'Sonstiges', 0, 0, 0, 6 FROM `facilities`;
