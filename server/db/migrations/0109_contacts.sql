CREATE TABLE `contact_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contact_categories_facility_name` ON `contact_categories` (`facility_id`,lower("name"));--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer,
	`category_id` integer,
	`category_name` text,
	`organisation` text NOT NULL,
	`person` text DEFAULT '' NOT NULL,
	`role` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`mobile` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`street` text DEFAULT '' NOT NULL,
	`postal_code` text DEFAULT '' NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`website` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`visible_to_staff` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` integer,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `contact_categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `contacts_facility` ON `contacts` (`facility_id`);--> statement-breakpoint
CREATE INDEX `contacts_category` ON `contacts` (`category_id`);--> statement-breakpoint
ALTER TABLE `children` ADD `future_school_contact_id` integer REFERENCES contacts(id) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
-- The example categories for every existing facility (keep in step with DEFAULT_CONTACT_CATEGORIES in
-- shared/domain/contacts.ts; new facilities get them from createFacility).
INSERT INTO `contact_categories`("facility_id", "name", "sort_order")
SELECT f."id", n."column1", n."column2"
FROM `facilities` f CROSS JOIN (VALUES
	('Schulen', 0), ('Jugendamt', 1), ('Gesundheitsamt', 2), ('Fachberatung', 3), ('Ärztinnen/Ärzte & Therapie', 4),
	('Träger & Verwaltung', 5), ('Handwerk & Notdienst', 6), ('Sonstiges', 7)
) n
ORDER BY f."id", n."column2";