import type { StaffingRuleSet } from '../types'
import { leitung, shares } from './common'

/** Rheinland-Pfalz: Vollzeitstellen je Platz nach Alter, bezogen auf 7 Std./Tag (KiTaG § 21). */
export const RP: StaffingRuleSet[] = [{
  land: 'RP',
  validFrom: '2021-07-01',
  source: 'KiTaG Rheinland-Pfalz § 21 Abs. 3/4 (Personalquote), § 22 (Leitungsdeputat); in Kraft seit 01.07.2021',
  confidence: 'high',
  note: 'Das Land rechnet je Platz der Betriebserlaubnis; hier je Vertragskind, anteilig nach Betreuungsstunden '
    + '(Bezug 7 Std./Tag). Nicht abgebildet: kleine Einrichtungen mind. 2 Vollzeitstellen; mind. 0,256 Stellen je '
    + 'tägliche Betreuungsstunde; Leitung +0,005 Stellen je 40 Std. wöchentliche Betreuungszeit (Leitungswerte aus '
    + 'einer kommunalen Quelle, nicht im Gesetz geprüft). Auszubildende zählen nicht; Anrechnung von '
    + 'Ergänzungskräften nicht geprüft. Mindestbesetzung hier je Gruppe geprüft; das Gesetz meint ggf. die ganze '
    + 'Einrichtung – bitte prüfen.',
  method: 'fte_per_child',
  fteHoursPerWeek: 39,
  demand: [
    // under 2 first: a child without age in months falls through to the 2 to school entry row
    { ageBand: 'u3', ageMonths: { below: 24 }, childrenPerFte: 1, fteUnits: 0.263, refHoursPerWeek: 35 },
    { ageBand: 'u3', childrenPerFte: 1, fteUnits: 0.1, refHoursPerWeek: 35 },
    { ageBand: 'ue3', childrenPerFte: 1, fteUnits: 0.1, refHoursPerWeek: 35 },
    { ageBand: 'school', childrenPerFte: 1, fteUnits: 0.086, refHoursPerWeek: 35 },
  ],
  addOns: [leitung({ mode: 'fte_flat', fte: 0.128 })],
  // 2 Fachkräfte at the same time during the Betreuungszeit
  presence: [{ window: 'always', minFachkraft: 2 }],
  staffShares: shares(),
  quotas: [],
}]
