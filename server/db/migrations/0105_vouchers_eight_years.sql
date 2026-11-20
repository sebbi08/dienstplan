PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_retention_settings` (
	`facility_id` integer PRIMARY KEY NOT NULL,
	`time_years` integer DEFAULT 2 NOT NULL,
	`assessment_years` integer DEFAULT 3 NOT NULL,
	`paid_overtime_years` integer DEFAULT 8 NOT NULL,
	`pension_years` integer DEFAULT 30 NOT NULL,
	`cash_years` integer DEFAULT 10 NOT NULL,
	`bem_years` integer DEFAULT 3 NOT NULL,
	`maternity_years` integer DEFAULT 2 NOT NULL,
	`employee_delete` text DEFAULT 'managers' NOT NULL,
	`payroll_office` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_retention_settings`("facility_id", "time_years", "assessment_years", "paid_overtime_years", "pension_years", "cash_years", "bem_years", "maternity_years", "employee_delete", "payroll_office") SELECT "facility_id", "time_years", "assessment_years", "paid_overtime_years", "pension_years", "cash_years", "bem_years", "maternity_years", "employee_delete", "payroll_office" FROM `retention_settings`;--> statement-breakpoint
DROP TABLE `retention_settings`;--> statement-breakpoint
ALTER TABLE `__new_retention_settings` RENAME TO `retention_settings`;--> statement-breakpoint
-- Buchungsbelege 8 years since 2025 (§ 147 Abs. 3 AO, § 257 Abs. 4 HGB): the former default 10 becomes 8, a period the
-- Träger set himself stays.
UPDATE `retention_settings` SET `paid_overtime_years` = 8 WHERE `paid_overtime_years` = 10;--> statement-breakpoint
PRAGMA foreign_keys=ON;