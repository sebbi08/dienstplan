import type { DemandRule, Qualification, StaffingRuleSet } from '../types'
import { leitung, shares, TRAINEES_NOTE, TRAINEES_REVISED } from './common'

const BASE_NOTE = 'Berechnet je Monat; das Land rechnet im Jahresdurchschnitt aus Stichtagen. Leitung nach Zahl der '
  + 'Betreuungskräfte, hier nach dem Soll in Vollzeitkräften. Abwesenheiten bis 6 Wochen zählen weiter, bis 5 % '
  + 'Vertretungsreserve – nicht abgebildet.'

const NOTE = `${BASE_NOTE} Auszubildende = tätigkeitsbegleitende Qualifizierung (70 %).`

const TRAINEES = `${TRAINEES_NOTE} Angestellte Auszubildende (PiA/berufsbegleitend) und Studierende (dual/`
  + 'berufsbegleitend, Kindheits- oder Sozialpädagogik) = tätigkeitsbegleitende Qualifizierung: 70 % für die '
  + 'Finanzierung (KitaPersV § 17 Abs. 1; nach mind. 2 Jahren als Ergänzungskraft 80 % – beim Mitarbeiter '
  + 'eintragen); sie zählen zur Fachkraftquote von 80 % (§§ 15, 16). Nicht geprüft: als Fachkraft zählen sie nur '
  + 'bis zur Zahl der Fachkräfte ohne zugeordnete Ergänzungskraft (§ 15 Abs. 1 S. 2). Studierende als '
  + 'tätigkeitsbegleitende Qualifizierung: abgeleitet, nicht ausdrücklich geregelt. Vollzeitschüler, Praktikanten, '
  + 'Praxissemester und Werkstudenten zählen nicht.'

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

/** The 80 % Fachkraft quota (KitaPersV § 16) over the given qualifications. */
const fachkraftquote = (qualifications: Qualification[]): StaffingRuleSet['quotas'] => [{
  key: 'fachkraftquote', label: 'Fachkräfte', kind: 'min_share', qualifications, pct: 80, base: 'required',
}]

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
  quotas: fachkraftquote(['fachkraft']),
}

const revised: StaffingRuleSet = {
  ...current,
  validFrom: TRAINEES_REVISED,
  source: 'KitaG Brandenburg § 10 Abs. 1 (zuletzt geändert 23.06.2025); KitaPersV §§ 3, 5, 9, 15–17; MBJS-FAQ zur '
    + 'Kita-Personalverordnung',
  note: `${TRAINEES} Beginn der Fassung vom 23.06.2025 nicht recherchiert. ${BASE_NOTE}`,
  staffShares: shares({ ergaenzung: 80, azubi_1: 70, azubi_2: 70, azubi_3: 70, studium_1: 70, studium_2: 70, studium_3: 70 }),
  quotas: fachkraftquote(['fachkraft', 'azubi_1', 'azubi_2', 'azubi_3', 'studium_1', 'studium_2', 'studium_3']),
}

/** Brandenburg: Stellen je Kinderzahl nach Alter und Betreuungszeit (KitaG § 10, KitaPersV). */
export const BB: StaffingRuleSet[] = [
  current,
  revised,
  {
    // U3 step to 1 : 4 as enacted (Art. 3 of the law of 28.06.2023); a postponement was reported as planned
    ...revised,
    validFrom: '2027-01-01',
    source: 'KitaG Brandenburg § 10 Abs. 1 (U3 ab 01.01.2027 nach Art. 3 des Gesetzes vom 28.06.2023); '
      + 'KitaPersV §§ 3, 5, 9, 15–17; MBJS-FAQ zur Kita-Personalverordnung',
    confidence: 'medium',
    note: `Laut Gesetz ab 01.01.2027 1:4; eine Verschiebung war laut Presse geplant – bitte prüfen. ${TRAINEES} `
      + BASE_NOTE,
    demand: demand(4),
  },
]
