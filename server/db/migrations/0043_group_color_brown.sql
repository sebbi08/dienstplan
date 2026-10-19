-- The group colour "Blau" was too close to the blue of training (Fortbildung) in the calendar; it becomes "Hellbraun".
UPDATE groups SET color = 'brown' WHERE color = 'blue';
