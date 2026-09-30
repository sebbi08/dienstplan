import { describe, expect, it } from 'vitest'
import { buildDayOverview } from '../../shared/domain/dayOverview'
import { code, F1, M, shift, special } from '../helpers/entries'

const date = '2026-10-06'
const slot = (minutes: number) => (minutes - 420) / 15

describe('buildDayOverview', () => {
  it('uses 15-minute slots from 7:00 to 17:00 by default', () => {
    const overview = buildDayOverview([{ employeeId: 1, entries: [shift(1, date, ...M)] }], false)
    expect(overview.slotStarts[0]).toBe(420)
    expect(overview.slotStarts.at(-1)).toBe(1005)
    expect(overview.slotStarts).toHaveLength(40)
  })
  it('marks work and breaks by slot start', () => {
    const { rows } = buildDayOverview([{ employeeId: 1, entries: [shift(1, date, ...M)] }], false)
    const states = rows[0]!.states
    expect(states[slot(450)]).toBe('off')
    expect(states[slot(465)]).toBe('work')
    expect(states[slot(690)]).toBe('work')
    expect(states[slot(705)]).toBe('break')
    expect(states[slot(720)]).toBe('break')
    expect(states[slot(735)]).toBe('work')
    expect(states[slot(960)]).toBe('off')
  })
  it('counts present staff per slot, excluding housekeeping and breaks', () => {
    const overview = buildDayOverview([
      { employeeId: 1, entries: [shift(1, date, ...M)] },
      { employeeId: 2, entries: [shift(2, date, ...F1)] },
      { employeeId: 3, entries: [shift(3, date, 660, 960, null, null, { countsAsStaff: false })] },
      { employeeId: 4, entries: [code(4, date, 'prep_time', 'timed', 450, 570)] },
    ], false)
    expect(overview.rows[2]!.states[slot(660)]).toBe('support')
    expect(overview.rows[3]!.states[slot(450)]).toBe('prep_time')
    expect(overview.present[slot(420)]).toBe(1)
    expect(overview.present[slot(465)]).toBe(3)
    expect(overview.present[slot(705)]).toBe(1)
  })
  it('fills full-day codes and holidays across the row', () => {
    const overview = buildDayOverview([
      { employeeId: 1, entries: [code(1, date, 'sick', 'daily_target')] },
      { employeeId: 2, entries: [] },
    ], true)
    expect(new Set(overview.rows[0]!.states)).toEqual(new Set(['absent']))
    expect(new Set(overview.rows[1]!.states)).toEqual(new Set(['holiday']))
    expect(overview.present.every(count => count === 0)).toBe(true)
  })
  it('extends the range to entries outside 7:00–17:00', () => {
    const overview = buildDayOverview([{ employeeId: 1, entries: [special(1, date, 840, 1110)] }], false)
    expect(overview.slotStarts.at(-1)).toBe(1125)
    expect(overview.slotStarts).toHaveLength(48)
  })
})
