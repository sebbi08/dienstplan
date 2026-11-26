-- „Nur Kinderzahlen“ (Mitarbeitende → Person → Zugang, server/services/countsOnly.ts): the person sees no child data
-- anywhere, at the tablet only the names-free numbers of the day („Kinder heute“). Only a new column, off for everyone.
ALTER TABLE `employees` ADD `counts_only` integer DEFAULT false NOT NULL;
