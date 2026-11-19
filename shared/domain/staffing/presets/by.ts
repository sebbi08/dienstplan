import type { StaffingRuleSet } from '../types'
import { shares, TRAINEES_NOTE, TRAINEES_REVISED } from './common'

const current: StaffingRuleSet = {
  land: 'BY',
  validFrom: '2026-01-01',
  source: 'AVBayKiBiG § 17 (Fassung ab 28.07.2026), § 16; BayKiBiG Art. 21 Abs. 5 (Fassung ab 01.01.2026)',
  confidence: 'high',
  note: 'Weitere Gewichte (Behinderung 4,5; nichtdeutschsprachige Eltern 1,3; Tagespflege 1,3) erst mit dem '
    + 'Kindergewicht; das Gewicht 4,5 dürfte nicht für die Fachkraftquote zählen – hier nicht abgebildet. Berechnet '
    + 'wird je Monat; Jahresdurchschnitt und bis zu 3 Monate Überschreitung nicht abgebildet. Leitung ist enthalten. '
    + 'Berufspraktikanten (Erzieherausbildung) zählen als Ergänzungskräfte. Nicht abgebildet: Buchungen bis 3 '
    + 'Std./Tag für Kinder ab 3 werden nicht gefördert; Kräfte, die 42 Tage oder länger fehlen, zählen ab dem '
    + 'Folgemonat nicht. Anrechnung von Auszubildenden (SPS/PiA) nicht geprüft (Ministeriumsvorgabe).',
  method: 'child_hours',
  fteHoursPerWeek: 39,
  demand: [
    { ageBand: 'u3', childWeight: 2.0, childHoursPerStaffHour: 11 },
    { ageBand: 'ue3', childWeight: 1.0, childHoursPerStaffHour: 11 },
    { ageBand: 'school', childWeight: 1.2, childHoursPerStaffHour: 11 },
  ],
  addOns: [],
  presence: [],
  staffShares: shares(),
  quotas: [{
    key: 'fachkraftquote', label: 'Fachkraftquote', kind: 'min_share',
    qualifications: ['fachkraft'], pct: 50, base: 'required',
  }],
}

/** Bayern: Anstellungsschlüssel 1 : 11,0 gewichtete Buchungsstunden (AVBayKiBiG § 17, BayKiBiG Art. 21). */
export const BY: StaffingRuleSet[] = [
  current,
  {
    ...current,
    validFrom: TRAINEES_REVISED,
    source: 'AVBayKiBiG § 17 (Fassung ab 28.07.2026), § 16; BayKiBiG Art. 21 Abs. 5 (Fassung ab 01.01.2026); '
      + 'Allgemeinverfügungen StMAS (BayMBl. 2024 Nr. 34, 2025 Nr. 314)',
    note: `${TRAINEES_NOTE} Berufspraktikum (Erzieher) zählt als Ergänzungskraft (§ 16 Abs. 4 Nr. 2 AVBayKiBiG), `
      + 'PiA ab dem 2. Ausbildungsjahr als Ergänzungskraft, im 1. Jahr nicht (Allgemeinverfügung, BayMBl. 2024 '
      + 'Nr. 34); jeweils mit allen Stunden, nicht für die Fachkraftquote. Kinderpflege- und SPS-Auszubildende zählen '
      + 'nicht – beim Mitarbeiter 0 % eintragen. Duales oder berufsbegleitendes Studium und Praxissemester zählen '
      + 'nicht; nur die Kombinierte Ausbildung (Fachakademie mit Bachelor) im Praxissemester als Ergänzungskraft, ab '
      + 'dem 6. Semester als Fachkraft (BayMBl. 2025 Nr. 314) – beim Mitarbeiter eintragen. Weitere Gewichte '
      + '(Behinderung 4,5; nichtdeutschsprachige Eltern 1,3; Tagespflege 1,3) erst mit dem Kindergewicht; das '
      + 'Gewicht 4,5 dürfte nicht für die Fachkraftquote zählen – hier nicht abgebildet. Berechnet wird je Monat; '
      + 'Jahresdurchschnitt und bis zu 3 Monate Überschreitung nicht abgebildet. Leitung ist enthalten. Nicht '
      + 'abgebildet: Buchungen bis 3 Std./Tag für Kinder ab 3 werden nicht gefördert; Kräfte, die 42 Tage oder länger '
      + 'fehlen, zählen ab dem Folgemonat nicht.',
    staffShares: shares({ azubi_2: 100, azubi_3: 100, praktikant: 100 }),
  },
]
