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
  it('marks the persons\' cells', () => {
    const warning: Warning = { type: 'short_rest', date: '2026-10-06', employeeId: 1, from: 1320, to: 420 }
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
