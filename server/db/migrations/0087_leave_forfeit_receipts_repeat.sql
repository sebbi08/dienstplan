DROP INDEX `leave_forfeit_receipts_employee_year`;--> statement-breakpoint
CREATE INDEX `leave_forfeit_receipts_employee_year` ON `leave_forfeit_receipts` (`employee_id`,`year`);