ALTER TABLE `form_attachments` ADD `uploaded_by_user_id` integer REFERENCES users(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `form_attachments` ADD `uploaded_by_employee_id` integer REFERENCES employees(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `form_templates` ADD `print_layout` text;--> statement-breakpoint
UPDATE `form_templates` SET `print_layout` = 'u1000' WHERE `starter_key` = 'accident_u1000';
