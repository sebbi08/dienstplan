import type { DemandRule, StaffingRuleSet } from '../types'
import { leitung, shares } from './common'

const NOTE = 'Berechnet je Monat; das Land rechnet im Jahresdurchschnitt aus Stichtagen. Leitung nach Zahl der '
  + 'Betreuungskräfte, hier nach dem Soll in Vollzeitkräften. Abwesenheiten bis 6 Wochen zählen weiter, bis 5 % '
  + 'Vertretungsreserve – nicht abgebildet. Auszubildende = tätigkeitsbegleitende Qualifizierung (70 %).'

/** Mindestbetreuungszeit: 6 h/day up to school entry, 4 h/day for school children; above = verlängert. */
function demand(u3ChildrenPerFte: number): DemandRule[] {
  return [
    { ageBand: 'u3', weeklyHours: { upTo: 30 }, childrenPerFte: u3ChildrenPerFte, fteUnits: 0.8 },
    { ageBand: 'u3', weeklyHours: { over: 30 }, childrenPerFte: u3ChildrenPerFte, fteUnits: 1.0 },
    { ageBand: 'ue3', weeklyHours: { upTo: 30 }, childrenPerFte: 10, fteUnits: 0.8 },
    { ageBand: 'ue3', weeklyHours: { over: 30 }, childrenPerFte: 10, fteUnits: 1.0 },
    { ageBand: 'school', weeklyHours: { upTo: 20 }, childrenPerFte: 15, fteUnits: 0.6 },
    { ageBand: 'school', weeklyHours: { over: 20 }, childrenPerFte: 15, fteUnits: 0.8 },
  ]
}

const current: StaffingRuleSet = {
  land: 'BB',
  validFrom: '2025-06-23',
  source: 'KitaG Brandenburg § 10 Abs. 1 (zuletzt geändert 23.06.2025); KitaPersV §§ 3, 5, 17',
  confidence: 'high',
  note: `Beginn dieser Fassung nicht recherchiert (Datum der letzten Änderung). ${NOTE}`,
  method: 'fte_per_child',
  fteHoursPerWeek: 40,
  demand: demand(4.25),
  addOns: [
    { key: 'leitung_sockel', label: 'Leitungszeit (Sockel)', scope: 'facility', counts: false, mode: 'fte_flat', fte: 0.0625 },
    leitung({
      mode: 'step_table', basis: 'demand_fte',
      steps: [{ upTo: 4, fte: 0.125 }, { upTo: 10, fte: 0.25 }, { upTo: 15, fte: 0.375 }, { upTo: null, fte: 0.5 }],
    }),
  ],
  presence: [],
  staffShares: shares({ ergaenzung: 80, azubi_1: 70, azubi_2: 70, azubi_3: 70 }),
  quotas: [{
    key: 'fachkraftquote', label: 'Fachkräfte mind. 80 %', kind: 'min_share',
    qualifications: ['fachkraft'], pct: 80, base: 'required',
  }],
}

/** Brandenburg: Stellen je Kinderzahl nach Alter und Betreuungszeit (KitaG § 10, KitaPersV). */
export const BB: StaffingRuleSet[] = [
  current,
  {
    // U3 step to 1 : 4 as enacted (Art. 3 of the law of 28.06.2023); a postponement was reported as planned
    ...current,
    validFrom: '2027-01-01',
    source: 'KitaG Brandenburg § 10 Abs. 1 (U3 ab 01.01.2027 nach Art. 3 des Gesetzes vom 28.06.2023); '
      + 'KitaPersV §§ 3, 5, 17',
    confidence: 'medium',
    note: `Laut Gesetz ab 01.01.2027 1:4; eine Verschiebung war laut Presse geplant – bitte prüfen. ${NOTE}`,
    demand: demand(4),
  },
]
