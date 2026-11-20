CREATE TABLE `facility_eve_rules` (
	`facility_id` integer NOT NULL,
	`from_year` integer NOT NULL,
	`mode` text NOT NULL,
	PRIMARY KEY(`facility_id`, `from_year`),
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `facility_eve_rules` (`facility_id`, `from_year`, `mode`)
	SELECT `id`, 0, CASE WHEN `christmas_eve_half_leave` = 1 THEN 'half' ELSE 'whole' END FROM `facilities`;
--> statement-breakpoint
INSERT INTO `facility_eve_rules` (`facility_id`, `from_year`, `mode`)
	SELECT `id`, 2026, 'paid' FROM `facilities` WHERE `tvoed_sue` = 1 OR `christmas_eve_paid_free` = 1;
