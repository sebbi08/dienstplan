-- „Dienstplan bearbeiten“ at the tablet (server/services/tabletUnlock.ts): when the unlocking person started editing the
-- plan with this unlock (null = child records only). Only a new nullable column: existing unlocks stay as they are.
ALTER TABLE `terminal_unlocks` ADD `plan_edit_since` text;