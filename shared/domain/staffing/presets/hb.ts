import type { StaffingRuleSet } from '../types'
import { shares } from './common'

/**
 * Bremen: only a simultaneous presence rule (BremKTG § 10a), no period demand.
 * Fachkraft = sozialpädagogische Fachkraft (§ 10 Abs. 3); Ergänzungskraft = Fachkraft mit
 * eingeschränkter Verantwortung (§ 10 Abs. 4).
 */
export const HB: StaffingRuleSet[] = [{
  land: 'HB',
  validFrom: '2025-09-05',
  source: 'BremKTG § 10a Mindestpersonalausstattung (in Kraft seit 05.09.2025), § 10 Abs. 3/4',
  confidence: 'high',
  note: 'Nur Mindestbesetzung „gleichzeitig“, kein Monats-Soll. Das Gesetz unterscheidet nach Einrichtungsart; hier '
    + 'nach Gruppenart. Flexibilität bis 31.07.2030 (außerhalb von 30 Std. Kernförderzeit zwei Kräfte nach Abs. 4, '
    + 'Vertretung bis 5 Tage) nicht abgebildet. Städte können strengere Schlüssel festlegen; RiBTK ab 2026 und '
    + 'Leitungszeit nicht geprüft.',
  periodCheck: false,
  method: 'fte_per_child',
  fteHoursPerWeek: 39,
  groupTypes: [
    { key: 'krippe', label: 'Krippe (unter 3)' },
    { key: 'alterserweitert', label: 'Alterserweiterte Gruppe (18 Monate bis Schule)' },
    { key: 'kindergarten', label: 'Kindergarten (3 bis Schule)' },
    { key: 'hort', label: 'Hort' },
  ],
  demand: [],
  addOns: [],
  presence: [
    // every group (also without group type): 1 Fachkraft per started 20 children
    { window: 'always', perChildren: { children: 20, staff: 1, fachkraft: 1 } },
    // U3: 1 Fachkraft + 1 Kraft (Abs. 4) together for up to 10 children
    { window: 'always', groupTypes: ['krippe'], perChildren: { children: 10, staff: 2, fachkraft: 1 } },
    // alterserweitert: the same pair for up to 15 children (max. 5 U3)
    { window: 'always', groupTypes: ['alterserweitert'], perChildren: { children: 15, staff: 2, fachkraft: 1 } },
  ],
  staffShares: shares(),
  quotas: [],
}]
