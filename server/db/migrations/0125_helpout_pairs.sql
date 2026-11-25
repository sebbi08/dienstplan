CREATE TABLE `facility_helpout_pairs` (
	`facility_a_id` integer NOT NULL,
	`facility_b_id` integer NOT NULL,
	PRIMARY KEY(`facility_a_id`, `facility_b_id`),
	FOREIGN KEY (`facility_a_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`facility_b_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `facility_helpout_pairs_b` ON `facility_helpout_pairs` (`facility_b_id`);