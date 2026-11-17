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
