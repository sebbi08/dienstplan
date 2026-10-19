import { describe, expect, it } from 'vitest'
import { splitLeavers } from '../../app/utils/leavers'

const today = '2026-10-19'
const person = (id: number, leftOn: string | null) => ({ id, leftOn })

describe('splitLeavers', () => {
  it('archives only those who left before today and keeps the order in both lists', () => {
    const { active, archived } = splitLeavers([
      person(1, '2026-10-18'), // left yesterday
      person(2, null),
      person(3, '2026-10-19'), // leaves today
      person(4, '2025-07-31'),
      person(5, '2026-10-20'), // leaves tomorrow
    ], today)
    expect(active.map(employee => employee.id)).toEqual([2, 3, 5])
    expect(archived.map(employee => employee.id)).toEqual([1, 4])
  })
  it('handles an empty list', () => {
    expect(splitLeavers([], today)).toEqual({ active: [], archived: [] })
  })
})
