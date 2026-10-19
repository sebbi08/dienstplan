CREATE TABLE `child_attendance_meals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`day_id` integer NOT NULL,
	`meal_id` integer NOT NULL,
	`value` integer NOT NULL,
	FOREIGN KEY (`day_id`) REFERENCES `child_attendance_days`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`meal_id`) REFERENCES `meals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `child_attendance_meals_day_meal` ON `child_attendance_meals` (`day_id`,`meal_id`);--> statement-breakpoint
CREATE INDEX `child_attendance_meals_meal` ON `child_attendance_meals` (`meal_id`);--> statement-breakpoint
CREATE TABLE `meal_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`meal_id` integer NOT NULL,
	`valid_from` text,
	`name` text NOT NULL,
	`time` integer NOT NULL,
	`removed` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`meal_id`) REFERENCES `meals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meal_versions_meal_valid_from` ON `meal_versions` (`meal_id`,`valid_from`);--> statement-breakpoint
CREATE TABLE `meals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer NOT NULL,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `meals_facility` ON `meals` (`facility_id`);--> statement-breakpoint
-- Data copy (by hand): every facility gets its two fixed meals as meals since always, first Snack, then Mittagessen.
INSERT INTO `meals` (`facility_id`) SELECT `id` FROM `facilities` ORDER BY `id`;--> statement-breakpoint
INSERT INTO `meal_versions` (`meal_id`, `valid_from`, `name`, `time`, `removed`)
  SELECT `meals`.`id`, NULL, 'Snack', `facilities`.`snack_time`, 0 FROM `meals`
  JOIN `facilities` ON `facilities`.`id` = `meals`.`facility_id` ORDER BY `meals`.`id`;--> statement-breakpoint
INSERT INTO `meals` (`facility_id`) SELECT `id` FROM `facilities` ORDER BY `id`;--> statement-breakpoint
INSERT INTO `meal_versions` (`meal_id`, `valid_from`, `name`, `time`, `removed`)
  SELECT `meals`.`id`, NULL, 'Mittagessen', `facilities`.`lunch_time`, 0 FROM `meals`
  JOIN `facilities` ON `facilities`.`id` = `meals`.`facility_id`
  WHERE NOT EXISTS (SELECT 1 FROM `meal_versions` WHERE `meal_versions`.`meal_id` = `meals`.`id`) ORDER BY `meals`.`id`;--> statement-breakpoint
-- The ticks set by hand (null = counted automatically: no row), to the meal of the same name of the child's facility.
INSERT INTO `child_attendance_meals` (`day_id`, `meal_id`, `value`)
  SELECT `child_attendance_days`.`id`, `meal_versions`.`meal_id`, `child_attendance_days`.`snack` FROM `child_attendance_days`
  JOIN `children` ON `children`.`id` = `child_attendance_days`.`child_id`
  JOIN `meals` ON `meals`.`facility_id` = `children`.`facility_id`
  JOIN `meal_versions` ON `meal_versions`.`meal_id` = `meals`.`id` AND `meal_versions`.`name` = 'Snack'
  WHERE `child_attendance_days`.`snack` IS NOT NULL;--> statement-breakpoint
INSERT INTO `child_attendance_meals` (`day_id`, `meal_id`, `value`)
  SELECT `child_attendance_days`.`id`, `meal_versions`.`meal_id`, `child_attendance_days`.`lunch` FROM `child_attendance_days`
  JOIN `children` ON `children`.`id` = `child_attendance_days`.`child_id`
  JOIN `meals` ON `meals`.`facility_id` = `children`.`facility_id`
  JOIN `meal_versions` ON `meal_versions`.`meal_id` = `meals`.`id` AND `meal_versions`.`name` = 'Mittagessen'
  WHERE `child_attendance_days`.`lunch` IS NOT NULL;
