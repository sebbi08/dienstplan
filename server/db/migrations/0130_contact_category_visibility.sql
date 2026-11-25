-- „Wer sieht sie?“ for the categories of „Kontakte“, like the print template and „Wissen“ categories (shared/domain/contacts.ts).
-- Every existing category gets 'all': what each contact shows stays exactly as before (its own setting decides).
ALTER TABLE `contact_categories` ADD `visibility` text DEFAULT 'all' NOT NULL;
