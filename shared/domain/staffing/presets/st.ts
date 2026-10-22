import type { StaffingRuleSet } from '../types'
import { shares } from './common'

/** Sachsen-Anhalt: Fachkraftstunden je gebuchte Betreuungsstunde (KiFöG LSA § 21). */
export const ST: StaffingRuleSet[] = [{
  land: 'ST',
  validFrom: '2019-08-01',
  source: 'KiFöG LSA § 21 (Fassung ab 01.08.2019), § 22',
  confidence: 'medium',
  note: 'Bitte prüfen: Ob das Gesetz „Kita Stabil“ (eingebracht 17.12.2025) die Faktoren geändert hat, ist nicht '
    + 'bestätigt. Das Land rechnet mit Jahressummen für die ganze Einrichtung; hier je Monat und Gruppe. Zehn '
    + 'Ausfalltage je Vollzeitkraft sind im Schlüssel enthalten. Leitung („angemessen“) ohne Zahl. Es zählen nur '
    + 'Fachkräfte nach § 21 Abs. 3; Hilfskräfte nicht.',
  method: 'child_hours',
  fteHoursPerWeek: 39,
  demand: [
    { ageBand: 'u3', staffHoursPerChildHour: 0.187 },
    { ageBand: 'ue3', staffHoursPerChildHour: 0.083 },
    { ageBand: 'school', staffHoursPerChildHour: 0.052 },
  ],
  addOns: [],
  presence: [],
  staffShares: shares({ ergaenzung: 0 }),
  quotas: [],
}]
