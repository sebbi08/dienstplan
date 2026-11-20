-- The school cutoff now means „the 6th year completed by the end of this day“ (§ 187 Abs. 2, § 188 Abs. 2 BGB): the
-- former presets become the new ones where a facility still has them, so its school starts stay as they were. Hamburg
-- 1 July → 30 June; Bayern and Nordrhein-Westfalen 30 September → 29 September; Thüringen 1 August → 31 July. A cutoff
-- set otherwise stays.
UPDATE `facilities` SET `school_cutoff_month` = 6, `school_cutoff_day` = 30 WHERE `state` = 'HH' AND `school_cutoff_month` = 7 AND `school_cutoff_day` = 1 AND `school_age_years` = 6;--> statement-breakpoint
UPDATE `facilities` SET `school_cutoff_day` = 29 WHERE `state` IN ('BY', 'NW') AND `school_cutoff_month` = 9 AND `school_cutoff_day` = 30 AND `school_age_years` = 6;--> statement-breakpoint
UPDATE `facilities` SET `school_cutoff_month` = 7, `school_cutoff_day` = 31 WHERE `state` = 'TH' AND `school_cutoff_month` = 8 AND `school_cutoff_day` = 1 AND `school_age_years` = 6;
