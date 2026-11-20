import type { StaffingRuleSet } from '../types'
import { leitung, shares } from './common'

/** Saarland: Fachkraftfaktor je Gruppe (SBEBG § 4, AVO-SBEBG § 2). */
export const SL: StaffingRuleSet[] = [{
  land: 'SL',
  validFrom: '2022-04-01',
  source: 'SBEBG §§ 3–5 (in Kraft seit 01.04.2022, geändert 26.04.2023 und 16.09.2026); AVO-SBEBG § 2',
  confidence: 'low',
  note: 'Bitte prüfen: Krippe 2,67 und Kindergarten 2,0 Fachkräfte je Gruppe stammen aus einer Sekundärquelle, nicht '
    + 'aus dem Verordnungstext; die Bezugs-Betreuungszeit ist unbekannt (daher keine Anpassung an die Öffnungszeit). '
    + 'Hort ohne Werte. Verfügungszeit (25 %) ist enthalten. Kinderpfleger/Kinderkrankenpfleger höchstens 1/3 der '
    + 'übrigen Fachkräfte – nicht abgebildet. Leitung 6 Std. je Gruppe (+1 Std. nach KiQuTG nicht enthalten). '
    + 'Personen in Ausbildung zählen nicht. Ab 2027 neue Regeln – Werte bitte prüfen: Das Gesetz vom 16.09.2026 (Amtsbl. I '
    + 'Nr. 39 S. 1006) fasst den Fachkräftekatalog (§ 3 Abs. 4 SBEBG; Kinderpfleger/innen für Krippe und Kindergarten, '
    + 'nicht Hort) ab 01.01.2027 bzw. 01.08.2027 neu und begrenzt die Schließtage; ob sich die Schlüssel (§ 4) ändern, '
    + 'ist nicht geprüft (Stand 19.11.2026).',
  method: 'group_fte',
  fteHoursPerWeek: 39,
  groupTypes: [
    { key: 'krippe', label: 'Krippengruppe' },
    { key: 'kindergarten', label: 'Kindergartengruppe' },
  ],
  demand: [
    { groupType: 'krippe', ftePerGroup: 2.67 },
    { groupType: 'kindergarten', ftePerGroup: 2.0 },
  ],
  addOns: [leitung({ mode: 'hours_per_group', hours: 6 })],
  presence: [],
  staffShares: shares(),
  quotas: [],
}]
