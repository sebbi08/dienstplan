-- Stamping on the tablet is always allowed; former "phone only" employees may use both.
UPDATE `employees` SET `stamp_via` = 'both' WHERE `stamp_via` = 'phone';
