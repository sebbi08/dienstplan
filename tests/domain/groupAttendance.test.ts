import { describe, expect, it } from 'vitest'
import { groupAttendance } from '../../shared/domain/attendance'
import { code, M, shift } from '../helpers/entries'

const date = '2026-10-06'

describe('groupAttendance (persons working in a group per day)', () => {
  it('does not count a person working from home that day', () => {
    const homeGroups = new Map<number, number | null>([[1, 5], [2, 5], [3, 5]])
    const entries = [
      shift(1, date, ...M),
      shift(2, date, ...M, { homeOffice: true }),
      { ...code(3, date, 'office', 'timed', 480, 600), homeOffice: true },
    ]
    expect(groupAttendance(1, [5], homeGroups, entries, [date])).toEqual({ 5: { [date]: 1 } })
  })
})
