import { describe, expect, it } from 'vitest'
import { suggestFullShift, type SuggestDayEntry, type SuggestTemplate } from '../../shared/domain/suggest'

const templates: SuggestTemplate[] = [
  { id: 1, start: 420, end: 795, breakStart: null, breakEnd: null, pairsWithPrepTime: false }, // F1 7:00–13:15
  { id: 2, start: 450, end: 945, breakStart: 700, breakEnd: 730, pairsWithPrepTime: true }, // F2 7:30–15:45
  { id: 3, start: 465, end: 960, breakStart: 700, breakEnd: 730, pairsWithPrepTime: true }, // M 7:45–16:00
  { id: 4, start: 525, end: 1020, breakStart: 730, breakEnd: 760, pairsWithPrepTime: true }, // S 8:45–17:00
  { id: 5, start: 660, end: 960, breakStart: null, breakEnd: null, pairsWithPrepTime: false }, // HK 11:00–16:00
]
const vz = (start: number, end: number): SuggestDayEntry => ({ kind: 'code', codeKey: 'prep_time', start, end, breakStart: null, breakEnd: null })
const suggest = (entries: SuggestDayEntry[], missing: number) => suggestFullShift(entries, missing, templates)?.id

describe('suggestFullShift', () => {
  it('suggests a full shift that encloses the VZ (counted once)', () => {
    // VZ 14:00–16:00, 5:48 h missing: F2 adds 6:00 h, M and S add 5:45 h each → M (comes first).
    expect(suggest([vz(840, 960)], 348)).toBe(3)
  })
  it('only offers shifts that enclose the VZ when there are some', () => {
    // VZ 16:00–17:00 lies only inside S.
    expect(suggest([vz(960, 1020)], 408)).toBe(4)
    // VZ 7:30–8:30 lies only inside F2.
    expect(suggest([vz(450, 510)], 408)).toBe(2)
  })
  it('falls back to the closest marked shift when none encloses the VZ', () => {
    // VZ 7:00–7:30 is before all marked shifts: F2 adds 7:45 h, M 7:45 h, S 7:45 h → first one (F2).
    expect(suggest([vz(420, 450)], 438)).toBe(2)
  })
  it('never suggests unmarked shifts (F1, HK)', () => {
    expect(suggest([vz(700, 760)], 400)).not.toBe(1)
    expect(suggestFullShift([vz(700, 760)], 400, templates.filter(t => !t.pairsWithPrepTime))).toBeNull()
  })
})
