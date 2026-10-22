import type { StaffingRuleSet } from '../types'
import { leitung, shares } from './common'

/**
 * Niedersachsen: Kräfte je Gruppe in Kern- und Randzeit (NKiTaG § 11). The law is presence-based;
 * the monthly demand counts the staff per group (2, Krippe from 11 children 3) plus Verfügungszeit.
 */
export const NI: StaffingRuleSet[] = [{
  land: 'NI',
  validFrom: '2025-08-01',
  source: 'NKiTaG §§ 7, 9–12 (Änderungen vom 18.06.2024 und 13.12.2024); DVO-NKiTaG § 7',
  confidence: 'high',
  note: 'Monats-Soll vereinfacht: 2 Kräfte je Gruppe (Krippe ab 11 belegten Plätzen 3 – die dritte Kraft ist nur in '
    + 'der Kernzeit nötig), ohne Anpassung an die Öffnungszeit; maßgeblich ist die Anwesenheit (Kernzeit = '
    + 'Hauptbetreuungszeit; die dritte Krippen-Kraft wird ab 11 anwesenden Kindern geprüft). Leitung: 5 Std. je Gruppe, bei Gruppen bis 10 Kindern nur 2,5 Std. (+10 Std. unter '
    + 'Bedingungen) – nicht unterschieden. Verfügungszeit +0,8 Std. je Platzsharing-Platz nicht abgebildet. '
    + 'Flexibilitäten (erfahrene Assistenzkräfte als Gruppenleitung bis 31.07.2030; zwei Assistenzkräfte in der '
    + 'Randzeit; Vertretung durch andere geeignete Personen 5 Tage/Monat bis 31.07.2026, dann 3) nicht abgebildet; '
    + 'Verlängerung der Fristen zum 31.07.2026 nicht geprüft. Anrechnung von Auszubildenden nicht geprüft.',
  method: 'group_fte',
  fteHoursPerWeek: 39,
  groupTypes: [
    { key: 'krippe', label: 'Krippengruppe' },
    { key: 'kindergarten', label: 'Kindergartengruppe' },
    { key: 'altersuebergreifend', label: 'Altersübergreifende Gruppe' },
    { key: 'hort', label: 'Hortgruppe' },
  ],
  demand: [
    { groupType: 'krippe', minChildren: 11, ftePerGroup: 3 },
    { ftePerGroup: 2 },
  ],
  addOns: [
    { key: 'verfuegung', label: 'Verfügungszeit', scope: 'group', counts: true, mode: 'hours_per_group', hours: 7.5 },
    leitung({ mode: 'hours_per_group', hours: 5 }),
  ],
  presence: [
    // Kernzeit and Randzeit: 2 pedagogical Kräfte, at least 1 Fachkraft
    { window: 'always', minStaff: 2, minFachkraft: 1 },
    // Krippe with 11 or more children: a 3rd Kraft during the whole Kernzeit
    { window: 'haupt', groupTypes: ['krippe'], minChildren: 11, minStaff: 3, minFachkraft: 1 },
  ],
  staffShares: shares(),
  quotas: [],
}]
