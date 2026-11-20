ALTER TABLE `requirement_types` ADD `first_interval_months` integer;--> statement-breakpoint
-- ArbMedVV / AMR 2.1: the Betriebsarzt (Pflichtvorsorge) a second time after 12 months, then every 36 months; only where
-- the interval is still the former default of 24 months (an interval the facility set itself stays as it is).
UPDATE `requirement_types` SET `interval_months` = 36, `first_interval_months` = 12 WHERE `builtin_key` = 'company_doctor' AND `interval_months` = 24;
