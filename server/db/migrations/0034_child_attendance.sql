CREATE TABLE `child_attendance_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`child_id` integer NOT NULL,
	`date` text NOT NULL,
	`field` text NOT NULL,
	`before` text NOT NULL,
	`after` text NOT NULL,
	`changed_at` text NOT NULL,
	`changed_by_user_id` integer,
	`changed_by_employee_id` integer,
	`changed_by_name` text NOT NULL,
	FOREIGN KEY (`child_id`) REFERENCES `children`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`changed_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`changed_by_employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `child_attendance_changes_child_date` ON `child_attendance_changes` (`child_id`,`date`);--> statement-breakpoint
CREATE TABLE `child_attendance_days` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`child_id` integer NOT NULL,
	`date` text NOT NULL,
	`group_id` integer,
	`planned_pickup` integer,
	`brought_by` text DEFAULT '' NOT NULL,
	`absence` text,
	`note` text DEFAULT '' NOT NULL,
	`snack` integer,
	`lunch` integer,
	FOREIGN KEY (`child_id`) REFERENCES `children`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `child_attendance_days_child_date` ON `child_attendance_days` (`child_id`,`date`);--> statement-breakpoint
CREATE TABLE `child_attendance_months` (
	`child_id` integer NOT NULL,
	`month` text NOT NULL,
	`remark` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`child_id`) REFERENCES `children`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `child_attendance_months_child_month` ON `child_attendance_months` (`child_id`,`month`);--> statement-breakpoint
CREATE TABLE `child_attendance_stays` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`day_id` integer NOT NULL,
	`arrived` integer NOT NULL,
	`left` integer,
	`picked_up_by` text,
	`picked_up_contact_id` integer,
	FOREIGN KEY (`day_id`) REFERENCES `child_attendance_days`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`picked_up_contact_id`) REFERENCES `child_contacts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `child_attendance_stays_day` ON `child_attendance_stays` (`day_id`);--> statement-breakpoint
CREATE TABLE `child_pickup_announcements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`day_id` integer NOT NULL,
	`name` text NOT NULL,
	`announced_by` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`day_id`) REFERENCES `child_attendance_days`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `child_pickup_announcements_day` ON `child_pickup_announcements` (`day_id`);--> statement-breakpoint
ALTER TABLE `facilities` ADD `snack_time` integer DEFAULT 570 NOT NULL;--> statement-breakpoint
ALTER TABLE `facilities` ADD `lunch_time` integer DEFAULT 720 NOT NULL;--> statement-breakpoint
ALTER TABLE `facilities` ADD `record_brought_by` integer DEFAULT false NOT NULL;