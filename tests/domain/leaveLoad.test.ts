import { describe, expect, it } from 'vitest'
import { daysOverLimit, leaveLoad } from '../../shared/domain/leaveLoad'

describe('leave load', () => {
  it('counts different people per day and finds the days above the limit', () => {
    const load = leaveLoad([
      { employeeId: 1, date: '2026-12-21' }, { employeeId: 1, date: '2026-12-21' }, // planned and requested: once
      { employeeId: 2, date: '2026-12-21' }, { employeeId: 3, date: '2026-12-21' },
      { employeeId: 2, date: '2026-12-22' },
    ])
    expect(Object.fromEntries(load)).toEqual({ '2026-12-21': 3, '2026-12-22': 1 })
    expect(daysOverLimit(load, ['2026-12-21', '2026-12-22', '2026-12-23'], 2)).toEqual(['2026-12-21'])
    expect(daysOverLimit(load, ['2026-12-21'], null)).toEqual([])
  })
})
