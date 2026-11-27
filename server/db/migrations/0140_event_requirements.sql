-- Pflichttermine as appointments: an appointment may name the kind of mandatory appointment its participants keep
-- (null = ordinary appointment; the kind deleted → ordinary again), and when the attendance was confirmed. An entry
-- created by a confirmation names its appointment (deleted appointment → the entry stays, entered as by hand).
-- drizzle-kit leaves the ON DELETE of an added column out; added by hand.
ALTER TABLE `calendar_events` ADD `requirement_type_id` integer REFERENCES requirement_types(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `calendar_events` ADD `attendance_confirmed_at` text;--> statement-breakpoint
ALTER TABLE `employee_requirements` ADD `calendar_event_id` integer REFERENCES calendar_events(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `employee_requirements_event` ON `employee_requirements` (`calendar_event_id`);
