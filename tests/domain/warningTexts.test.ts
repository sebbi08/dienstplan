import { describe, expect, it } from 'vitest'
import type { Warning } from '../../shared/domain/warnings'
import { indexWarnings, warningText } from '../../app/utils/warnings'

const names = new Map([[1, 'Anna']])

describe('warning texts', () => {
  it('names a group gap with its time span', () => {
    expect(warningText({
      type: 'staffing', date: '2026-10-05', groupId: 7, groupName: 'Bären', from: 420, to: 480, have: 1, need: 2, fachkraft: true,
    }, names)).toBe('Bären 7:00–8:00: 1 Fachkraft, nötig 2')
  })

  it('words a stamp on a day with a full-day absence', () => {
    expect(warningText({ type: 'record_on_absence', date: '2026-10-05', employeeId: 1 }, names)).toBe(
      'Anna: gestempelt trotz ganztägiger Abwesenheit (z. B. Urlaub, Schließtag) – die Zeit zählt erst, wenn der Tag im Dienstplan geändert wird',
    )
    expect(warningText({ type: 'target_gap', date: '2026-10-05', employeeId: 1, missingMinutes: 90 }, names))
      .toBe('Anna: noch 1:30 h bis zum Tagessoll')
  })

  it('words more Kinderkrankentage than the entitlement and marks the person\'s cell', () => {
    const warning: Warning = { type: 'child_sick_days', date: '2026-10-05', employeeId: 1, taken: 16, entitlement: 15 }
    expect(warningText(warning, names)).toBe('Anna: 16 Kinderkrankentage – Anspruch 15 (§ 45 SGB V)')
    // For plan editors who may not see the children: without the numbers.
    expect(warningText({ ...warning, taken: null, entitlement: null }, names)).toBe('Anna: Kinderkrankentage über dem Anspruch (§ 45 SGB V)')
    expect([...indexWarnings([warning]).byCell.values()]).toEqual([[warning]])
  })
})

describe('Mutterschutz texts (§§ 4–6 MuSchG)', () => {
  const base = { type: 'maternity', date: '2026-11-18', employeeId: 1, phase: 'pregnancy' } as const
  it('words each rule', () => {
    expect(warningText({ ...base, rule: 'hours', value: 540, limit: 510 }, names))
      .toBe('Anna: 9:00 Std. – in der Schwangerschaft höchstens 8,5 Std. (§ 4 MuSchG)')
    expect(warningText({ ...base, rule: 'hours', value: 510, limit: 480 }, names))
      .toBe('Anna: 8:30 Std. – in der Schwangerschaft höchstens 8 Std. (§ 4 MuSchG)')
    expect(warningText({ ...base, phase: 'breastfeeding', rule: 'hours', value: 540, limit: 510 }, names))
      .toBe('Anna: 9:00 Std. – in der Stillzeit höchstens 8,5 Std. (§ 4 MuSchG)')
    expect(warningText({ ...base, rule: 'late', value: 1230, limit: 1200 }, names)).toBe('Anna: Arbeit nach 20 Uhr (§ 5 MuSchG)')
    expect(warningText({ ...base, rule: 'early', value: 330, limit: 360 }, names)).toBe('Anna: Arbeit vor 6 Uhr (§ 5 MuSchG)')
    expect(warningText({ ...base, rule: 'sunday', value: 180, limit: 0 }, names)).toBe('Anna: Sonn-/Feiertagsarbeit (§ 6 MuSchG)')
    expect(warningText({ ...base, rule: 'rest', value: 630, limit: 660 }, names)).toBe('Anna: nur 10:30 Std. Ruhezeit (§ 4 MuSchG)')
    expect(warningText({ ...base, date: '2026-11-30', rule: 'average', value: 1521, limit: 1200 }, names))
      .toBe('Anna: Ø 25:21 Std./Woche im November – mehr als vertraglich (§ 4 MuSchG)')
    expect(warningText({ ...base, rule: 'doubleWeek', value: 5940, limit: 5400 }, names))
      .toBe('Anna: 99:00 Std. in der Doppelwoche – höchstens 90 Std. (§ 4 MuSchG)')
    // After the birth there is no limit, only the ban.
    expect(warningText({ ...base, phase: 'after', rule: 'protected', value: 360, limit: 0 }, names))
      .toBe('Anna: Beschäftigungsverbot nach der Entbindung (§ 3 MuSchG)')
    expect(warningText({ ...base, phase: 'after', rule: 'protected', value: 360, limit: 0, miscarriage: true }, names))
      .toBe('Anna: Schutzfrist nach der Fehlgeburt (§ 3 Abs. 5 MuSchG)')
    expect(warningText({ ...base, rule: 'ban', value: 360, limit: 0 }, names)).toBe('Anna: Dienst trotz Beschäftigungsverbot (§§ 13, 16 MuSchG)')
  })

  it('tells plan editors without the right neither rule nor reason, and marks the cell', () => {
    const warning: Warning = { type: 'work_limit', date: '2026-11-18', employeeId: 1, minutes: 540 }
    expect(warningText(warning, names)).toBe('Anna: Arbeitszeitgrenze überschritten')
    expect([...indexWarnings([warning]).byCell.values()]).toEqual([[warning]])
  })
})

describe('working time law texts (§ 3 and § 5 ArbZG)', () => {
  it('words more than 10 hours planned and worked', () => {
    expect(warningText({ type: 'max_hours', date: '2026-10-05', employeeId: 1, minutes: 645 }, names))
      .toBe('Anna: 10:45 Std. geplant – erlaubt sind höchstens 10 Std. (§ 3 ArbZG)')
    expect(warningText({ type: 'max_hours_recorded', date: '2026-10-05', employeeId: 1, minutes: 601 }, names))
      .toBe('Anna: 10:01 Std. gearbeitet – mehr als 10 Std. (§ 3 ArbZG)')
  })
  it('words a short rest with both days, also over a month boundary', () => {
    expect(warningText({ type: 'short_rest', date: '2026-10-06', employeeId: 1, from: 1320, to: 420 }, names))
      .toBe('Anna: nur 9:00 Std. Ruhezeit zwischen 22:00 (Mo) und 7:00 (Di) – mindestens 11 Std. (§ 5 ArbZG)')
    expect(warningText({ type: 'short_rest_recorded', date: '2026-11-01', employeeId: 1, from: 1291, to: 425 }, names))
      .toBe('Anna: nur 9:34 Std. Ruhezeit zwischen 21:31 (Sa) und 7:05 (So) – mindestens 11 Std. (§ 5 ArbZG)')
  })
  it('words more than 6 hours in a row without a break (§ 4 Satz 3)', () => {
    expect(warningText({ type: 'long_stretch', date: '2026-10-06', employeeId: 1, minutes: 390 }, names))
      .toBe('Anna: 6:30 Std. ohne Pause geplant – länger als 6 Std. am Stück nur mit Ruhepause (§ 4 ArbZG, Pausen ab 15 Min.)')
  })
  it('marks the persons\' cells', () => {
    const warning: Warning = { type: 'short_rest', date: '2026-10-06', employeeId: 1, from: 1320, to: 420 }
    expect([...indexWarnings([warning]).byCell.values()]).toEqual([[warning]])
  })
})

describe('Jugendarbeitsschutz texts (JArbSchG)', () => {
  const base = { type: 'youth', date: '2026-11-18', employeeId: 1 } as const
  it('words each rule with its paragraph, without the birth date', () => {
    expect(warningText({ ...base, rule: 'hours', value: 540, limit: 480 }, names))
      .toBe('Anna: 9:00 Std. geplant – unter 18 höchstens 8 Std. am Tag (§ 8 JArbSchG)')
    expect(warningText({ ...base, rule: 'hours', value: 540, limit: 510 }, names))
      .toBe('Anna: 9:00 Std. geplant – unter 18 höchstens 8,5 Std. am Tag (§ 8 JArbSchG)')
    expect(warningText({ ...base, rule: 'week', value: 2460, limit: 2400 }, names))
      .toBe('Anna: 41:00 Std. in dieser Woche – unter 18 höchstens 40 Std. (§ 8 JArbSchG)')
    expect(warningText({ ...base, rule: 'days', value: 6, limit: 5 }, names))
      .toBe('Anna: 6 Arbeitstage in dieser Woche – unter 18 höchstens 5 (§ 15 JArbSchG)')
    expect(warningText({ ...base, rule: 'early', value: 330, limit: 360 }, names))
      .toBe('Anna: Arbeit ab 5:30 Uhr – unter 18 nur von 6 bis 20 Uhr (§ 14 JArbSchG)')
    expect(warningText({ ...base, rule: 'late', value: 1230, limit: 1200 }, names))
      .toBe('Anna: Arbeit bis 20:30 Uhr – unter 18 nur von 6 bis 20 Uhr (§ 14 JArbSchG)')
    expect(warningText({ ...base, rule: 'saturday', value: 120, limit: 0 }, names))
      .toBe('Anna: Arbeit am Samstag – unter 18 nur in Ausnahmefällen (§ 16 JArbSchG)')
    expect(warningText({ ...base, rule: 'sunday', value: 120, limit: 0 }, names))
      .toBe('Anna: Arbeit am Sonntag – unter 18 nur in Ausnahmefällen (§ 17 JArbSchG)')
    expect(warningText({ ...base, rule: 'holiday', value: 120, limit: 0 }, names))
      .toBe('Anna: Arbeit am Feiertag – unter 18 nur in Ausnahmefällen (§ 18 JArbSchG)')
    expect(warningText({ ...base, rule: 'rest', value: 690, limit: 720 }, names))
      .toBe('Anna: nur 11:30 Std. Freizeit seit dem Vortag – unter 18 mindestens 12 Std. (§ 13 JArbSchG)')
    expect(warningText({ ...base, rule: 'break', value: 30, limit: 60 }, names))
      .toBe('Anna: 30 Min. Pause – unter 18 bei mehr als 6 Std. Arbeit mindestens 60 Min. (§ 11 JArbSchG)')
    expect(warningText({ ...base, rule: 'break', value: 0, limit: 30 }, names))
      .toBe('Anna: 0 Min. Pause – unter 18 bei mehr als 4,5 Std. Arbeit mindestens 30 Min. (§ 11 JArbSchG)')
    expect(warningText({ ...base, rule: 'stretch', value: 300, limit: 270 }, names))
      .toBe('Anna: 5:00 Std. ohne Pause – unter 18 höchstens 4,5 Std. am Stück (§ 11 JArbSchG)')
    expect(warningText({ ...base, rule: 'schoolDay', value: 180, limit: 0 }, names))
      .toBe('Anna: Dienst an einem langen Berufsschultag (mehr als 5 Unterrichtsstunden) – unter 18 einmal pro Woche frei (§ 9 JArbSchG)')
    expect(warningText({ ...base, rule: 'schoolBefore', value: 420, limit: 480 }, names))
      .toBe('Anna: Dienst vor dem Unterricht um 8:00 Uhr – unter 18 nicht vor Unterricht, der vor 9 Uhr beginnt (§ 9 JArbSchG)')
  })

  it('words work after 14:00 on 24 and 31 December', () => {
    expect(warningText({ ...base, date: '2026-12-24', rule: 'eve', value: 960, limit: 840 }, names))
      .toBe('Anna: Arbeit bis 16:00 Uhr am 24.12. – unter 18 nicht nach 14 Uhr (§ 18 JArbSchG)')
  })

  it('asks for the missing birthday in the year of the 18th birthday', () => {
    const warning: Warning = { type: 'youth_birthday', date: '2026-11-02', employeeId: 1 }
    expect(warningText(warning, names)).toBe('Anna: Geburtstag fehlt – Jugendarbeitsschutz kann nicht sicher geprüft werden')
    expect([...indexWarnings([warning]).byCell.values()]).toEqual([[warning]])
  })

  it('asks for the missing birth year, and marks the cell', () => {
    const warning: Warning = { type: 'youth_birth_year', date: '2026-11-02', employeeId: 1 }
    expect(warningText(warning, names)).toBe('Anna: Geburtsjahr fehlt – Jugendarbeitsschutz kann nicht geprüft werden')
    expect([...indexWarnings([warning]).byCell.values()]).toEqual([[warning]])
  })
})

describe('indexWarnings', () => {
  it('collects the warnings per day and the persons\' per cell', () => {
    const warnings: Warning[] = [
      { type: 'missing_entry', date: '2026-10-05', employeeId: 1 },
      { type: 'coverage', date: '2026-10-05', ruleId: 3, label: 'Frühdienst', found: 1, required: 2 },
    ]
    const index = indexWarnings(warnings)
    expect(index.byDate.get('2026-10-05')).toEqual(warnings)
    expect([...index.byCell.values()]).toEqual([[warnings[0]]])
  })
})
