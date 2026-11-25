CREATE TABLE `knowledge_entry_order` (
	`facility_id` integer NOT NULL,
	`entry_id` integer NOT NULL,
	`sort_order` integer NOT NULL,
	PRIMARY KEY(`facility_id`, `entry_id`),
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`entry_id`) REFERENCES `knowledge_entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `knowledge_entry_order_entry` ON `knowledge_entry_order` (`entry_id`);--> statement-breakpoint
-- The facility's own entries keep their ▲/▼ order (knowledge_entries.sort_order is no longer read); the Träger's
-- entries have no row yet and follow by title, as before.
INSERT INTO `knowledge_entry_order`("facility_id", "entry_id", "sort_order")
SELECT "facility_id", "id", "sort_order" FROM `knowledge_entries` WHERE "facility_id" IS NOT NULL;
