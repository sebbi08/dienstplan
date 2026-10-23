import { describe, expect, it } from 'vitest'
import { builtRows, mergeRows, timeKey } from '../../app/utils/settingsForms'

interface Row { id: number | null; label: string }
const rows = (...entries: [number, string][]): Row[] => entries.map(([id, label]) => ({ id, label }))

describe('mergeRows', () => {
  const stored = rows([1, 'Früh'], [2, 'Spät'])
  const built = builtRows(stored)

  it('keeps a row with unsaved edits when another row was saved', () => {
    const current = rows([1, 'Früh (neu)'], [2, 'Spät'])
    const fresh = rows([1, 'Früh'], [2, 'Spät 2'])
    expect(mergeRows(current, built, fresh, new Set([2]))).toEqual(rows([1, 'Früh (neu)'], [2, 'Spät 2']))
  })

  it('takes the fresh values for untouched rows and for the row just saved', () => {
    const current = rows([1, 'Früh (neu)'], [2, 'Spät'])
    const fresh = rows([1, 'Früh (neu)'], [2, 'Spät, vom Server'])
    expect(mergeRows(current, built, fresh, new Set([1]))).toEqual(fresh)
  })

  it('adds new rows and drops deleted ones, in the order of the fresh list', () => {
    const current = rows([1, 'Früh (neu)'], [2, 'Spät'])
    const fresh = rows([3, 'Mittel'], [1, 'Früh'])
    expect(mergeRows(current, built, fresh)).toEqual(rows([3, 'Mittel'], [1, 'Früh (neu)']))
  })

  it('takes everything fresh the first time (nothing built yet)', () => {
    const fresh = rows([1, 'Früh'])
    expect(mergeRows(rows([1, 'alt']), new Map(), fresh)).toEqual(fresh)
  })

  it('returns the same form objects it keeps, so typing goes on in them', () => {
    const current = rows([1, 'Früh (neu)'])
    expect(mergeRows(current, built, rows([1, 'Früh']))[0]).toBe(current[0])
  })
})

describe('timeKey', () => {
  it('compares typed times as minutes, empty as null, unreadable as text', () => {
    expect(timeKey('8:00')).toBe(480)
    expect(timeKey('800')).toBe(480)
    expect(timeKey('')).toBeNull()
    expect(timeKey('25:99')).toBe('?25:99')
  })
})
