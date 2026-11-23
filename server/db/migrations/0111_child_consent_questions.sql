CREATE TABLE `child_consent_answers` (
	`child_id` integer NOT NULL,
	`question_id` integer NOT NULL,
	`value` integer NOT NULL,
	PRIMARY KEY(`child_id`, `question_id`),
	FOREIGN KEY (`child_id`) REFERENCES `children`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `child_consent_questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `child_consent_answers_question` ON `child_consent_answers` (`question_id`);--> statement-breakpoint
CREATE TABLE `child_consent_questions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer NOT NULL,
	`text` text NOT NULL,
	`short` text NOT NULL,
	`area` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`builtin_key` text,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `child_consent_questions_facility` ON `child_consent_questions` (`facility_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `child_consent_questions_facility_builtin` ON `child_consent_questions` (`facility_id`,`builtin_key`);--> statement-breakpoint
CREATE TABLE `child_overview_sheets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`facility_id` integer NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`columns` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `child_overview_sheets_facility` ON `child_overview_sheets` (`facility_id`);--> statement-breakpoint
INSERT INTO `child_consent_questions`("facility_id", "text", "short", "area", "sort_order", "hidden", "builtin_key")
SELECT f."id", d."column3", d."column4", d."column2", d."column5", 0, d."column1"
FROM `facilities` f CROSS JOIN (VALUES
	('artworkDisplay', 'Datenschutz', 'Bastel- und Malarbeiten aufhängen', 'Bastelarbeiten', 0),
	('photosDisplay', 'Datenschutz', 'Einzel- und Gruppenfotos aufhängen', 'Fotos aufhängen', 1),
	('photosForeignPortfolios', 'Datenschutz', 'Fotoerlaubnis für fremde Portfolios', 'Fremde Portfolios', 2),
	('photosInternalEvents', 'Datenschutz', 'Fotos hausinterner Feste', 'Fotos Feste', 3),
	('photosNamesBirthdaysDisplay', 'Datenschutz', 'Fotos, Namen und Geburtsdaten aufhängen', 'Fotos, Namen, Geb.', 4),
	('groupWorkWithNames', 'Datenschutz', 'Gruppenarbeiten mit Namen ausstellen', 'Gruppenarbeiten', 5),
	('whatsappContact', 'Messenger (WhatsApp, Signal)', 'Kontaktaufnahme über WhatsApp', 'Kontakt WhatsApp', 6),
	('whatsappPhotos', 'Messenger (WhatsApp, Signal)', 'Fotos über WhatsApp versenden', 'Fotos WhatsApp', 7),
	('signalPhotos', 'Messenger (WhatsApp, Signal)', 'Fotos über Signal versenden', 'Fotos Signal', 8),
	('whatsappParentGroup', 'Messenger (WhatsApp, Signal)', 'WhatsApp-Elterngruppe', 'Elterngruppe', 9),
	('mayTakeTemperature', 'Gesundheit', 'Fieber messen', 'Fieber', 10),
	('mayApplySunscreen', 'Gesundheit', 'Sonnenschutz auftragen', 'Sonnenschutz', 11),
	('mayApplyPlaster', 'Gesundheit', 'Pflaster kleben', 'Pflaster', 12),
	('insectRepellent', 'Gesundheit', 'Darf mit Insektenschutz eingesprüht werden', 'Insektenschutz', 13)
) d
ORDER BY f."id", d."column5";--> statement-breakpoint
INSERT INTO `child_consent_answers`("child_id", "question_id", "value")
SELECT c."id", q."id", c."consent_artwork_display" FROM `children` c
	JOIN `child_consent_questions` q ON q."facility_id" = c."facility_id" AND q."builtin_key" = 'artworkDisplay'
	WHERE c."consent_artwork_display" IS NOT NULL
UNION ALL
SELECT c."id", q."id", c."consent_photos_display" FROM `children` c
	JOIN `child_consent_questions` q ON q."facility_id" = c."facility_id" AND q."builtin_key" = 'photosDisplay'
	WHERE c."consent_photos_display" IS NOT NULL
UNION ALL
SELECT c."id", q."id", c."consent_photos_foreign_portfolios" FROM `children` c
	JOIN `child_consent_questions` q ON q."facility_id" = c."facility_id" AND q."builtin_key" = 'photosForeignPortfolios'
	WHERE c."consent_photos_foreign_portfolios" IS NOT NULL
UNION ALL
SELECT c."id", q."id", c."consent_photos_internal_events" FROM `children` c
	JOIN `child_consent_questions` q ON q."facility_id" = c."facility_id" AND q."builtin_key" = 'photosInternalEvents'
	WHERE c."consent_photos_internal_events" IS NOT NULL
UNION ALL
SELECT c."id", q."id", c."consent_photos_names_birthdays_display" FROM `children` c
	JOIN `child_consent_questions` q ON q."facility_id" = c."facility_id" AND q."builtin_key" = 'photosNamesBirthdaysDisplay'
	WHERE c."consent_photos_names_birthdays_display" IS NOT NULL
UNION ALL
SELECT c."id", q."id", c."consent_group_work_with_names" FROM `children` c
	JOIN `child_consent_questions` q ON q."facility_id" = c."facility_id" AND q."builtin_key" = 'groupWorkWithNames'
	WHERE c."consent_group_work_with_names" IS NOT NULL
UNION ALL
SELECT c."id", q."id", c."consent_whatsapp_contact" FROM `children` c
	JOIN `child_consent_questions` q ON q."facility_id" = c."facility_id" AND q."builtin_key" = 'whatsappContact'
	WHERE c."consent_whatsapp_contact" IS NOT NULL
UNION ALL
SELECT c."id", q."id", c."consent_whatsapp_photos" FROM `children` c
	JOIN `child_consent_questions` q ON q."facility_id" = c."facility_id" AND q."builtin_key" = 'whatsappPhotos'
	WHERE c."consent_whatsapp_photos" IS NOT NULL
UNION ALL
SELECT c."id", q."id", c."consent_signal_photos" FROM `children` c
	JOIN `child_consent_questions` q ON q."facility_id" = c."facility_id" AND q."builtin_key" = 'signalPhotos'
	WHERE c."consent_signal_photos" IS NOT NULL
UNION ALL
SELECT c."id", q."id", c."consent_whatsapp_parent_group" FROM `children` c
	JOIN `child_consent_questions` q ON q."facility_id" = c."facility_id" AND q."builtin_key" = 'whatsappParentGroup'
	WHERE c."consent_whatsapp_parent_group" IS NOT NULL
UNION ALL
SELECT c."id", q."id", c."may_take_temperature" FROM `children` c
	JOIN `child_consent_questions` q ON q."facility_id" = c."facility_id" AND q."builtin_key" = 'mayTakeTemperature'
	WHERE c."may_take_temperature" IS NOT NULL
UNION ALL
SELECT c."id", q."id", c."may_apply_sunscreen" FROM `children` c
	JOIN `child_consent_questions` q ON q."facility_id" = c."facility_id" AND q."builtin_key" = 'mayApplySunscreen'
	WHERE c."may_apply_sunscreen" IS NOT NULL
UNION ALL
SELECT c."id", q."id", c."may_apply_plaster" FROM `children` c
	JOIN `child_consent_questions` q ON q."facility_id" = c."facility_id" AND q."builtin_key" = 'mayApplyPlaster'
	WHERE c."may_apply_plaster" IS NOT NULL
UNION ALL
SELECT c."id", q."id", c."consent_insect_repellent" FROM `children` c
	JOIN `child_consent_questions` q ON q."facility_id" = c."facility_id" AND q."builtin_key" = 'insectRepellent'
	WHERE c."consent_insect_repellent" IS NOT NULL;--> statement-breakpoint
INSERT INTO `child_overview_sheets`("facility_id", "name", "sort_order", "columns")
SELECT f."id", 'Datenschutz', 0, json_array(
	json_object('type', 'consent', 'questionId', (SELECT q."id" FROM `child_consent_questions` q WHERE q."facility_id" = f."id" AND q."builtin_key" = 'artworkDisplay')),
	json_object('type', 'consent', 'questionId', (SELECT q."id" FROM `child_consent_questions` q WHERE q."facility_id" = f."id" AND q."builtin_key" = 'photosDisplay')),
	json_object('type', 'consent', 'questionId', (SELECT q."id" FROM `child_consent_questions` q WHERE q."facility_id" = f."id" AND q."builtin_key" = 'photosForeignPortfolios')),
	json_object('type', 'consent', 'questionId', (SELECT q."id" FROM `child_consent_questions` q WHERE q."facility_id" = f."id" AND q."builtin_key" = 'photosInternalEvents')),
	json_object('type', 'consent', 'questionId', (SELECT q."id" FROM `child_consent_questions` q WHERE q."facility_id" = f."id" AND q."builtin_key" = 'photosNamesBirthdaysDisplay')),
	json_object('type', 'consent', 'questionId', (SELECT q."id" FROM `child_consent_questions` q WHERE q."facility_id" = f."id" AND q."builtin_key" = 'groupWorkWithNames'))
) FROM `facilities` f ORDER BY f."id";--> statement-breakpoint
INSERT INTO `child_overview_sheets`("facility_id", "name", "sort_order", "columns")
SELECT f."id", 'Messenger', 1, json_array(
	json_object('type', 'consent', 'questionId', (SELECT q."id" FROM `child_consent_questions` q WHERE q."facility_id" = f."id" AND q."builtin_key" = 'whatsappContact')),
	json_object('type', 'consent', 'questionId', (SELECT q."id" FROM `child_consent_questions` q WHERE q."facility_id" = f."id" AND q."builtin_key" = 'whatsappPhotos')),
	json_object('type', 'consent', 'questionId', (SELECT q."id" FROM `child_consent_questions` q WHERE q."facility_id" = f."id" AND q."builtin_key" = 'signalPhotos')),
	json_object('type', 'consent', 'questionId', (SELECT q."id" FROM `child_consent_questions` q WHERE q."facility_id" = f."id" AND q."builtin_key" = 'whatsappParentGroup'))
) FROM `facilities` f ORDER BY f."id";--> statement-breakpoint
INSERT INTO `child_overview_sheets`("facility_id", "name", "sort_order", "columns")
SELECT f."id", 'Gesundheit', 2, json_array(
	json_object('type', 'field', 'key', 'measlesProof'),
	json_object('type', 'field', 'key', 'infectionBriefingDate'),
	json_object('type', 'field', 'key', 'allergies'),
	json_object('type', 'consent', 'questionId', (SELECT q."id" FROM `child_consent_questions` q WHERE q."facility_id" = f."id" AND q."builtin_key" = 'mayTakeTemperature')),
	json_object('type', 'consent', 'questionId', (SELECT q."id" FROM `child_consent_questions` q WHERE q."facility_id" = f."id" AND q."builtin_key" = 'mayApplySunscreen')),
	json_object('type', 'consent', 'questionId', (SELECT q."id" FROM `child_consent_questions` q WHERE q."facility_id" = f."id" AND q."builtin_key" = 'mayApplyPlaster')),
	json_object('type', 'consent', 'questionId', (SELECT q."id" FROM `child_consent_questions` q WHERE q."facility_id" = f."id" AND q."builtin_key" = 'insectRepellent'))
) FROM `facilities` f ORDER BY f."id";--> statement-breakpoint
INSERT INTO `child_overview_sheets`("facility_id", "name", "sort_order", "columns")
SELECT f."id", 'Abholberechtigte', 3, json_array(
	json_object('type', 'field', 'key', 'pickUp')
) FROM `facilities` f ORDER BY f."id";--> statement-breakpoint
INSERT INTO `child_overview_sheets`("facility_id", "name", "sort_order", "columns")
SELECT f."id", 'Sorgeberechtigte', 4, json_array(
	json_object('type', 'field', 'key', 'guardians'),
	json_object('type', 'field', 'key', 'contactBan')
) FROM `facilities` f ORDER BY f."id";--> statement-breakpoint
INSERT INTO `child_overview_sheets`("facility_id", "name", "sort_order", "columns")
SELECT f."id", 'Anruf-Reihenfolge', 5, json_array(
	json_object('type', 'field', 'key', 'emergency')
) FROM `facilities` f ORDER BY f."id";--> statement-breakpoint
INSERT INTO `child_overview_sheets`("facility_id", "name", "sort_order", "columns")
SELECT f."id", 'Telefonnummern', 6, json_array(
	json_object('type', 'field', 'key', 'address'),
	json_object('type', 'field', 'key', 'phones')
) FROM `facilities` f ORDER BY f."id";--> statement-breakpoint
INSERT INTO `child_overview_sheets`("facility_id", "name", "sort_order", "columns")
SELECT f."id", 'Elterngespräche', 7, json_array(
	json_object('type', 'field', 'key', 'lastMeeting'),
	json_object('type', 'field', 'key', 'nextMeeting'),
	json_object('type', 'field', 'key', 'allMeetings'),
	json_object('type', 'field', 'key', 'meetingCount')
) FROM `facilities` f ORDER BY f."id";