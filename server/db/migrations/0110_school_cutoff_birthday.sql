-- User decision 20.11.2026 („letzter Stichtag ist 30. Juni“): the stored school cut-off is again the last birthday that
-- still belongs to the year, as before 0106_school_cutoff_completed. The values 0106 set are reversed where a facility
-- of that state still has exactly them: Hamburg 30 June → 1 July; Bayern and Nordrhein-Westfalen 29 September →
-- 30 September; Thüringen 31 July → 1 August. A cut-off set otherwise stays.
UPDATE `facilities` SET `school_cutoff_month` = 7, `school_cutoff_day` = 1 WHERE `state` = 'HH' AND `school_cutoff_month` = 6 AND `school_cutoff_day` = 30 AND `school_age_years` = 6;--> statement-breakpoint
UPDATE `facilities` SET `school_cutoff_day` = 30 WHERE `state` IN ('BY', 'NW') AND `school_cutoff_month` = 9 AND `school_cutoff_day` = 29 AND `school_age_years` = 6;--> statement-breakpoint
UPDATE `facilities` SET `school_cutoff_month` = 8, `school_cutoff_day` = 1 WHERE `state` = 'TH' AND `school_cutoff_month` = 7 AND `school_cutoff_day` = 31 AND `school_age_years` = 6;
