import type { StaffingRuleSet } from '../types'
import { leitung, shares } from './common'

/** Baden-Württemberg: Vollzeitfachkräfte je Gruppe nach Gruppenart (KiTaVO § 1). */
export const BW: StaffingRuleSet[] = [{
  land: 'BW',
  validFrom: '2025-07-14',
  source: 'KiTaVO BW § 1 (Mindestpersonalschlüssel), § 1a; KiTaG BW § 7',
  confidence: 'high',
  note: 'Nicht abgebildet: Anpassung an mehr oder weniger als 26 Schließtage; Halbtags- und Regelgruppe brauchen '
    + 'eine zweite Kraft für die halbe Öffnungszeit; eingruppige Einrichtungen immer 2 Kräfte; Krippen-Schlüssel ab '
    + '15 Std./Woche. Übergangsregelung § 1a bis 31.08.2027 (Fachkraft durch Zusatzkräfte ersetzbar, höchstens '
    + '20 % unter dem Schlüssel, Meldung an den KVJS) nicht berücksichtigt. Zusatzkräfte zählen grundsätzlich nicht; '
    + 'Anrechnung von PiA/Auszubildenden nicht geprüft. Beginn dieser Fassung nicht recherchiert (Datum der '
    + 'Änderungsverordnung vom 14.07.2025).',
  method: 'group_fte',
  fteHoursPerWeek: 39,
  groupTypes: [
    { key: 'halbtag', label: 'Halbtagsgruppe' },
    { key: 'regel', label: 'Regelgruppe' },
    { key: 'voe', label: 'Gruppe mit verlängerter Öffnungszeit (VÖ)' },
    { key: 'ganztag', label: 'Ganztagsgruppe' },
    { key: 'krippe', label: 'Kinderkrippe' },
  ],
  // reference = average daily opening (Hauptbetreuungszeit + 1 h Randzeit); "mit U3" rows first
  demand: [
    { groupType: 'halbtag', withAgeBand: 'u3', ftePerGroup: 1.4, refHoursPerDay: 4 },
    { groupType: 'halbtag', ftePerGroup: 1.3, refHoursPerDay: 4 },
    { groupType: 'regel', withAgeBand: 'u3', ftePerGroup: 2.0, refHoursPerDay: 6 },
    { groupType: 'regel', ftePerGroup: 1.8, refHoursPerDay: 6 },
    { groupType: 'voe', withAgeBand: 'u3', ftePerGroup: 2.0, refHoursPerDay: 6 },
    { groupType: 'voe', ftePerGroup: 1.9, refHoursPerDay: 6 },
    { groupType: 'ganztag', ftePerGroup: 2.3, refHoursPerDay: 7 },
    { groupType: 'krippe', ftePerGroup: 2.06, refHoursPerDay: 7 },
  ],
  addOns: [leitung({ mode: 'hours_per_group', firstGroupHours: 6, hours: 2 })],
  presence: [
    // every group: one Fachkraft for the whole opening time
    { window: 'always', minFachkraft: 1 },
    // VÖ, Ganztag, Krippe: 2 Fachkräfte in the Hauptbetreuungszeit, 1 in the Randzeit
    { window: 'haupt', groupTypes: ['voe', 'ganztag', 'krippe'], minFachkraft: 2 },
  ],
  staffShares: shares({ ergaenzung: 0 }),
  quotas: [],
}]
