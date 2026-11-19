import { describe, expect, it } from 'vitest'
import type { Warning } from '../../shared/domain/warnings'
import { ackKeyDate, dayWarnings, isAcknowledged, warningAckKey, warningSignature } from '../../shared/domain/warningList'

const missing = (date: string, employeeId = 1): Warning => ({ type: 'missing_entry', date, employeeId })
const gap = (date: string, missingMinutes: number, employeeId = 1): Warning => ({ type: 'target_gap', date, employeeId, missingMinutes })
const staffing = (date: string, have = 1, from = 420, to = 480): Warning => ({
  type: 'staffing', date, groupId: 7, groupName: 'Bären', from, to, have, need: 2, fachkraft: true,
})
const coverage = (date: string, found = 1): Warning => ({ type: 'coverage', date, ruleId: 3, label: 'Frühdienst', found, required: 2 })
const acked = (...warnings: Warning[]) => new Map(warnings.map(warning => [warningAckKey(warning), warningSignature(warning)] as const))

describe('acknowledging', () => {
  it('keys a warning by type, day and subject', () => {
    expect(warningAckKey(missing('2026-10-05', 4))).toBe('missing_entry|2026-10-05|4')
    expect(warningAckKey(coverage('2026-10-05'))).toBe('coverage|2026-10-05|3')
    expect(warningAckKey(staffing('2026-10-05'))).toBe('staffing|2026-10-05|7|f|420-480')
    // By the group's id, so renaming the group keeps the acknowledgement.
    expect(warningAckKey({ type: 'edge', date: '2026-10-05', edge: 'closing', time: 1020, found: 0, required: 1, groupName: 'Mäuse', groupId: 5 }))
      .toBe('edge|2026-10-05|closing|5')
    expect(warningAckKey({ type: 'edge', date: '2026-10-05', edge: 'opening', time: 420, found: 0, required: 1 }))
      .toBe('edge|2026-10-05|opening|')
  })

  it('accepts only keys it writes itself', () => {
    const keys = [
      missing('2026-10-05', 4), coverage('2026-10-05'), staffing('2026-10-05'), gap('2026-10-05', 30),
      { type: 'edge', date: '2026-10-05', edge: 'closing', time: 1020, found: 0, required: 1, groupId: 5, groupName: 'Mäuse' },
      { type: 'edge', date: '2026-10-05', edge: 'opening', time: 420, found: 0, required: 1 },
    ].map(w => warningAckKey(w as Warning))
    for (const key of keys) expect(ackKeyDate(key)).toBe('2026-10-05')
    for (const key of [
      'nonsense', 'unknown_type|2026-10-05|1', 'toString|2026-10-05|1', 'missing_entry|05.10.2026|1', 'missing_entry|2026-10-05|',
      'missing_entry|2026-10-05|abc', 'missing_entry|2026-10-05|1|2', 'edge|2026-10-05|middle|5', 'edge|2026-10-05|opening|Mäuse',
      'staffing|2026-10-05|7|x|420-480', 'staffing|2026-10-05|7|f',
    ]) expect(ackKeyDate(key), key).toBeNull()
  })

  it('keys a Mutterschutz hint by person and rule, the hint for editors by person only', () => {
    const hours: Warning = { type: 'maternity', date: '2026-10-05', employeeId: 4, rule: 'hours', value: 540, limit: 510, phase: 'pregnancy' }
    expect(warningAckKey(hours)).toBe('maternity|2026-10-05|4|hours')
    expect(warningAckKey({ ...hours, rule: 'late', value: 1230, limit: 1200 })).toBe('maternity|2026-10-05|4|late')
    expect(warningSignature(hours)).toBe('540/510')
    expect(warningAckKey({ type: 'work_limit', date: '2026-10-05', employeeId: 4 })).toBe('work_limit|2026-10-05|4')
    expect(ackKeyDate('maternity|2026-10-05|4|average')).toBe('2026-10-05')
    expect(ackKeyDate('work_limit|2026-10-05|4')).toBe('2026-10-05')
    expect(ackKeyDate('maternity|2026-10-05|4')).toBeNull()
    expect(ackKeyDate('maternity|2026-10-05|4|lunch')).toBeNull()
    // The same rule with other values shows again.
    expect(isAcknowledged({ ...hours, value: 570 }, acked(hours))).toBe(false)
  })

  it('shows a warning again when its values changed', () => {
    const acks = new Map([[warningAckKey(gap('2026-10-05', 60)), warningSignature(gap('2026-10-05', 60))]])
    expect(isAcknowledged(gap('2026-10-05', 60), acks)).toBe(true)
    expect(isAcknowledged(gap('2026-10-05', 90), acks)).toBe(false)
    expect(isAcknowledged(gap('2026-10-06', 60), acks)).toBe(false)
    const covered = new Map([[warningAckKey(coverage('2026-10-05', 1)), warningSignature(coverage('2026-10-05', 1))]])
    expect(isAcknowledged(coverage('2026-10-05', 0), covered)).toBe(false)
    const staffed = new Map([[warningAckKey(staffing('2026-10-05', 1)), warningSignature(staffing('2026-10-05', 1))]])
    expect(isAcknowledged(staffing('2026-10-05', 0), staffed)).toBe(false)
    expect(isAcknowledged(staffing('2026-10-05', 1, 420, 510), staffed)).toBe(false)
  })
})

describe('dayWarnings', () => {
  it('shows no icon on a day without warnings', () => {
    expect(dayWarnings([], new Map())).toEqual({ items: [], state: 'none' })
  })

  it('is red while one warning of the day is not acknowledged', () => {
    const warnings = [staffing('2026-10-05'), missing('2026-10-05', 2)]
    const day = dayWarnings(warnings, acked(warnings[0]!))
    expect(day.state).toBe('open')
    expect(day.items.map(item => item.acknowledged)).toEqual([true, false])
  })

  it('turns grey when all warnings of the day are acknowledged', () => {
    const warnings = [staffing('2026-10-05'), missing('2026-10-05', 2)]
    expect(dayWarnings(warnings, acked(...warnings)).state).toBe('acknowledged')
  })

  it('keeps the warnings in their order with the key and signature to acknowledge them', () => {
    const warnings = [gap('2026-10-05', 60), coverage('2026-10-05')]
    expect(dayWarnings(warnings, new Map()).items).toEqual([
      { warning: warnings[0], key: 'target_gap|2026-10-05|1', signature: '60', acknowledged: false },
      { warning: warnings[1], key: 'coverage|2026-10-05|3', signature: '1/2', acknowledged: false },
    ])
  })

  it('counts a changed warning as new', () => {
    const day = dayWarnings([gap('2026-10-05', 90)], acked(gap('2026-10-05', 60)))
    expect(day.state).toBe('open')
    expect(day.items[0]!.acknowledged).toBe(false)
  })
})
