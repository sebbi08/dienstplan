-- „Längere Abwesenheit“ (shared/domain/longAbsence.ts): Langzeitkrank, Kur/Reha or Sonstiges per employee from a day to a
-- day or „bis auf Weiteres“ (end empty); gone with the employee. Only a new, empty table: nothing existing changes.
CREATE TABLE `long_absences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`reason` text NOT NULL,
	`start` text NOT NULL,
	`end` text,
	`created_by` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `long_absences_employee` ON `long_absences` (`employee_id`);