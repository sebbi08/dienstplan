ALTER TABLE `child_ifsg_cases` ADD `rule_anchor` text;--> statement-breakpoint
ALTER TABLE `child_ifsg_cases` ADD `rule_days` integer;--> statement-breakpoint
ALTER TABLE `child_ifsg_cases` ADD `rule_label` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `child_ifsg_cases` ADD `rule_condition` text DEFAULT '' NOT NULL;