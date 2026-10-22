import type { StaffingRuleSet } from '../types'
import { leitung, shares } from './common'

/** Thüringen: eine Fachkraft „zeitgleich regelmäßig“ für höchstens X Kinder nach Alter (ThürKigaG § 16). */
export const TH: StaffingRuleSet[] = [{
  land: 'TH',
  validFrom: '2025-01-01',
  source: 'ThürKigaG § 16 Abs. 2/3 (Fassung ab 01.01.2025, Gesetz vom 02.07.2024, GVBl. S. 202), § 17 Abs. 3, § 21',
  confidence: 'medium',
  note: 'Bitte prüfen: Bezug 9 Std./Tag (Hort 4 Std.), anteilig nach Betreuungsstunden, und die Leitung (0,01 '
    + 'Stellen je Kind, mind. 0,2, höchstens 1,5) stammen aus einer Sekundärquelle. Anwesenheit: 1 Fachkraft je 12 '
    + 'Kinder ab 3, unter 3 doppelt, Schulkinder 0,6 – Kinder unter 1 Jahr (1 : 4) bei der Anwesenheit nicht '
    + 'gesondert. Übergang bis Ende 2027 berichtet (nicht geprüft). Anrechnung von Ergänzungskräften und '
    + 'Auszubildenden nicht geprüft.',
  method: 'fte_per_child',
  fteHoursPerWeek: 39,
  demand: [
    // under 1 first: a child without age in months falls through to the 1–3 row
    { ageBand: 'u3', ageMonths: { below: 12 }, childrenPerFte: 4, refHoursPerWeek: 45 },
    { ageBand: 'u3', childrenPerFte: 6, refHoursPerWeek: 45 },
    { ageBand: 'ue3', childrenPerFte: 12, refHoursPerWeek: 45 },
    { ageBand: 'school', childrenPerFte: 20, refHoursPerWeek: 20 },
  ],
  addOns: [leitung({ mode: 'fte_per_child', fte: 0.01, minFte: 0.2, capFte: 1.5 })],
  // "zeitgleich": 1 Fachkraft per 12 children from 3, U3 count double (1 : 6), school children 12/20
  presence: [{ window: 'always', perChildren: { children: 12, staff: 1, fachkraft: 1 }, childWeights: { u3: 2, school: 0.6 } }],
  staffShares: shares(),
  quotas: [],
}]
