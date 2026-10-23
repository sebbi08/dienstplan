import { describe, expect, it } from 'vitest'
import { dateRange, isWeekend } from '../../shared/domain/dates'
import type { Warning } from '../../shared/domain/warnings'
import {
  ackKeyDate, condenseWarnings, filterWarnings, isAcknowledged, splitPast, warningAckKey, warningCategory, warningSections,
  warningSignature,
} from '../../shared/domain/warningList'

/** October 2026 without weekends; `except` removes further days (holidays, closures). */
function openDays(...except: string[]): Set<string> {
  return new Set(dateRange('2026-10-01', '2026-10-31').filter(date => !isWeekend(date) && !except.includes(date)))
}

const missing = (date: string, employeeId = 1): Warning => ({ type: 'missing_entry', date, employeeId })
const gap = (date: string, missingMinutes: number, employeeId = 1): Warning => ({ type: 'target_gap', date, employeeId, missingMinutes })
const staffing = (date: string, have = 1, from = 420, to = 480): Warning => ({
  type: 'staffing', date, groupId: 7, groupName: 'Bären', from, to, have, need: 2, fachkraft: true,
})
const coverage = (date: string, found = 1): Warning => ({ type: 'coverage', date, ruleId: 3, label: 'Frühdienst', found, required: 2 })

describe('warningCategory', () => {
  it('puts every type into one of the three groups', () => {
    expect(warningCategory(staffing('2026-10-05'))).toBe('staffing')
    expect(warningCategory(coverage('2026-10-05'))).toBe('staffing')
    expect(warningCategory({ type: 'edge', date: '2026-10-05', edge: 'opening', time: 420, found: 0, required: 1 })).toBe('staffing')
    expect(warningCategory(missing('2026-10-05'))).toBe('gaps')
    expect(warningCategory(gap('2026-10-05', 30))).toBe('gaps')
    for (const type of ['open_record', 'missing_record', 'break_rule', 'record_without_plan'] as const) {
      expect(warningCategory({ type, date: '2026-10-05', employeeId: 1 })).toBe('time')
    }
  })
})

describe('condenseWarnings', () => {
  it('joins the same warning on consecutive days into one line, across a weekend', () => {
    const lines = condenseWarnings(
      ['2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13'].map(date => staffing(date)), openDays(),
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ category: 'staffing', type: 'staffing', from: '2026-10-08', to: '2026-10-13', days: 4 })
    expect(lines[0]!.warnings).toHaveLength(4)
  })

  it('also joins across a holiday or closure day, but not across an open day without the warning', () => {
    expect(condenseWarnings([missing('2026-10-02'), missing('2026-10-06')], openDays('2026-10-05'))).toHaveLength(1)
    const lines = condenseWarnings([missing('2026-10-05'), missing('2026-10-07')], openDays())
    expect(lines.map(line => [line.from, line.to])).toEqual([['2026-10-05', '2026-10-05'], ['2026-10-07', '2026-10-07']])
  })

  it('joins a person\'s run over their days off (part-time), not over someone else\'s', () => {
    // Anna (1) does not work on Wednesdays; Mi 07.10. lies between.
    const offDays = new Map([[1, new Set(['2026-10-07'])]])
    const days = ['2026-10-05', '2026-10-06', '2026-10-08']
    const anna = condenseWarnings(days.map(date => missing(date, 1)), openDays(), offDays)
    expect(anna.map(line => [line.from, line.to, line.days])).toEqual([['2026-10-05', '2026-10-08', 3]])
    expect(condenseWarnings(days.map(date => missing(date, 2)), openDays(), offDays)).toHaveLength(2)
    expect(condenseWarnings(days.map(date => staffing(date)), openDays(), offDays)).toHaveLength(2)
  })

  it('breaks a run when the values differ', () => {
    const lines = condenseWarnings([staffing('2026-10-05', 1), staffing('2026-10-06', 0), staffing('2026-10-07', 0)], openDays())
    expect(lines.map(line => [line.from, line.to])).toEqual([['2026-10-05', '2026-10-05'], ['2026-10-06', '2026-10-07']])
    const covered = condenseWarnings([coverage('2026-10-05', 1), coverage('2026-10-06', 0)], openDays())
    expect(covered).toHaveLength(2)
  })

  it('keeps different time spans of a group and different people apart', () => {
    const lines = condenseWarnings([
      staffing('2026-10-05', 1, 420, 480), staffing('2026-10-05', 1, 900, 960),
      staffing('2026-10-06', 1, 420, 480), staffing('2026-10-06', 1, 900, 960),
      missing('2026-10-05', 1), missing('2026-10-06', 2),
    ], openDays())
    expect(lines).toHaveLength(4)
    const spans = lines.filter(line => line.type === 'staffing').map(line => line.warnings.map(w => (w as { from: number }).from))
    expect(spans).toEqual([[420, 420], [900, 900]])
  })

  it('sums the missing minutes of target gaps, whatever they are per day', () => {
    const lines = condenseWarnings([gap('2026-10-05', 60), gap('2026-10-06', 90), gap('2026-10-07', 30)], openDays())
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ days: 3, missingMinutes: 180 })
  })

  it('sorts the lines by their first day', () => {
    const lines = condenseWarnings([missing('2026-10-07', 2), missing('2026-10-05', 1), missing('2026-10-06', 1)], openDays())
    expect(lines.map(line => line.from)).toEqual(['2026-10-05', '2026-10-07'])
  })
})

describe('splitPast', () => {
  it('splits at today: today belongs to the current days', () => {
    const { current, past } = splitPast([missing('2026-10-21'), missing('2026-10-22'), missing('2026-10-23')], '2026-10-22')
    expect(past.map(w => w.date)).toEqual(['2026-10-21'])
    expect(current.map(w => w.date)).toEqual(['2026-10-22', '2026-10-23'])
  })
})

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

describe('warningSections', () => {
  const today = '2026-10-22'
  const warnings: Warning[] = [
    staffing('2026-10-20'), staffing('2026-10-21'), staffing('2026-10-22'), staffing('2026-10-23'),
    missing('2026-10-21'), missing('2026-10-26'),
    { type: 'missing_record', date: '2026-10-19', employeeId: 1 }, { type: 'missing_record', date: '2026-10-20', employeeId: 1 },
  ]

  it('shows the days from today on first and the past ones apart; time tracking only in the normal list', () => {
    const [besetzung, luecken, zeit] = warningSections(warnings, new Map(), openDays(), today)
    expect(besetzung).toMatchObject({ category: 'staffing', count: 4 })
    expect(besetzung!.current.map(line => [line.from, line.to])).toEqual([['2026-10-22', '2026-10-23']])
    expect(besetzung!.past.map(line => [line.from, line.to])).toEqual([['2026-10-20', '2026-10-21']])
    expect(luecken!.current.map(line => line.from)).toEqual(['2026-10-26'])
    expect(luecken!.past.map(line => line.from)).toEqual(['2026-10-21'])
    expect(zeit!.current.map(line => [line.from, line.to])).toEqual([['2026-10-19', '2026-10-20']])
    expect(zeit!.past).toEqual([])
  })

  it('counts only warnings not acknowledged and lists the acknowledged ones apart', () => {
    const acks = new Map([staffing('2026-10-22'), staffing('2026-10-23'), missing('2026-10-26')]
      .map(w => [warningAckKey(w), warningSignature(w)] as const))
    const sections = warningSections(warnings, acks, openDays(), today)
    expect(sections.map(section => section.count)).toEqual([2, 1, 2])
    expect(sections[0]!.current).toEqual([])
    expect(sections[0]!.acknowledged.map(line => [line.from, line.to])).toEqual([['2026-10-22', '2026-10-23']])
    expect(sections[0]!.acknowledgedCount).toBe(2)
    expect(sections[1]!.acknowledgedCount).toBe(1)
  })
})

describe('filterWarnings', () => {
  // Employee 3 is a Springer (no home group).
  const context = {
    employeeGroups: new Map<number, number | null>([[1, 7], [2, 8], [3, null]]), groupNames: new Map([[7, 'Bären'], [8, 'Mäuse']]),
  }
  const facilityOpening: Warning = { type: 'edge', date: '2026-10-05', edge: 'opening', time: 420, found: 0, required: 1 }
  const warnings: Warning[] = [
    staffing('2026-10-05'), missing('2026-10-05', 1), missing('2026-10-05', 2), coverage('2026-10-05'),
    { type: 'coverage', date: '2026-10-05', ruleId: 4, label: 'Spät', found: 0, required: 1, groupName: 'Mäuse' },
    { type: 'edge', date: '2026-10-05', edge: 'opening', time: 420, found: 0, required: 1, groupName: 'Bären', groupId: 7 },
    { type: 'edge', date: '2026-10-05', edge: 'closing', time: 960, found: 0, required: 1, groupName: 'Mäuse', groupId: 8 },
    facilityOpening, missing('2026-10-05', 3),
  ]

  it('keeps everything without a filter', () => {
    expect(filterWarnings(warnings, { groupId: null, employeeId: null }, context)).toHaveLength(warnings.length)
  })

  it('keeps a group\'s own warnings, those of its members and the facility-wide Besetzung', () => {
    const kept = filterWarnings(warnings, { groupId: 7, employeeId: null }, context)
    expect(kept.map(w => w.type)).toEqual(['staffing', 'missing_entry', 'coverage', 'edge', 'edge'])
    expect(kept).toContain(facilityOpening)
    expect(kept).toContainEqual(coverage('2026-10-05'))
    // A Springer's own warnings belong to no group.
    expect(kept).not.toContainEqual(missing('2026-10-05', 3))
  })

  it('counts the facility-wide Besetzung under a group filter', () => {
    const kept = filterWarnings(warnings, { groupId: 8, employeeId: null }, context)
    const [besetzung] = warningSections(kept, new Map(), openDays(), '2026-10-01')
    expect(besetzung!.count).toBe(4)
  })

  it('keeps only the warnings of one person', () => {
    const kept = filterWarnings(warnings, { groupId: null, employeeId: 2 }, context)
    expect(kept).toEqual([missing('2026-10-05', 2)])
    expect(filterWarnings(warnings, { groupId: 7, employeeId: 2 }, context)).toEqual([])
  })
})
