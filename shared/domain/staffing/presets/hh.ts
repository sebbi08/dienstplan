import type { StaffingRuleSet } from '../types'
import { shares } from './common'

/**
 * Hamburg: the Landesrahmenvertrag fixes weekly staff hours per child and Leistungsart; the current
 * values were not found. Approximation: the statutory Fachkraftschlüssel (Krippe 1 : 4, Elementar 1 : 10)
 * as staff hours per booked child hour.
 */
export const HH: StaffingRuleSet[] = [{
  land: 'HH',
  validFrom: '2024-01-01',
  source: 'KibeG (Fachkraftschlüssel Krippe 1 : 4, Elementar 1 : 10); Landesrahmenvertrag § 3, § 4, Anlage 1 b',
  confidence: 'low',
  note: 'Bitte prüfen: Die aktuellen Erziehungs- und Leitungswochenstunden je Leistungsart (K4–K12, E4–E12) wurden '
    + 'nicht gefunden; hier ersatzweise 1 Std. Personal je 4 (Krippe) bzw. 10 (Elementar) gebuchte Kinderstunden. '
    + 'Hort/VSK ohne Werte. Aufteilung Erst-/Zweitkraft und Leitungsstunden je Kind nicht abgebildet. Das Land '
    + 'rechnet über 12 Monate, bis 10 % Unterschreitung erlaubt – nicht abgebildet. Auszubildende nach '
    + 'berufsbegleitender Ausbildung (1. Jahr 30 %, 2./3. Jahr 90 % als Zweitkraft). Berufsbegleitende Erzieher '
    + 'im 3. Jahr zählen als Erstkraft (SPA nicht) – dann als Fachkraft mit 90 % eintragen.',
  method: 'child_hours',
  fteHoursPerWeek: 39,
  demand: [
    { ageBand: 'u3', childHoursPerStaffHour: 4 },
    { ageBand: 'ue3', childHoursPerStaffHour: 10 },
  ],
  addOns: [],
  presence: [],
  staffShares: shares({ azubi_1: 30, azubi_2: 90, azubi_3: 90 }),
  quotas: [],
}]
