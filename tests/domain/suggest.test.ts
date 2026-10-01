import { describe, expect, it } from 'vitest'
import { suggestShiftAfter, type SuggestTemplate } from '../../shared/domain/suggest'

const templates: SuggestTemplate[] = [
  { id: 1, start: 420, end: 795, breakStart: null, breakEnd: null, countsAsStaff: true }, // F1 7:00–13:15
  { id: 2, start: 450, end: 945, breakStart: 700, breakEnd: 730, countsAsStaff: true }, // F2 7:30–15:45
  { id: 3, start: 465, end: 960, breakStart: 700, breakEnd: 730, countsAsStaff: true }, // M 7:45–16:00
  { id: 4, start: 525, end: 1020, breakStart: 730, breakEnd: 760, countsAsStaff: true }, // S 8:45–17:00
  { id: 5, start: 660, end: 960, breakStart: null, breakEnd: null, countsAsStaff: false }, // HK 11:00–16:00
]

describe('suggestShiftAfter', () => {
  it('picks the fixed shift that best fills the missing time and starts it after VZ (VZ 7:30–9:30, 5:48 h missing)', () => {
    expect(suggestShiftAfter(570, 348, templates)).toEqual({ templateId: 2, start: 570, end: 945, breakStart: 700, breakEnd: 730 })
  })
  it('drops a break that would no longer lie inside the shortened shift', () => {
    // VZ until 12:00, 4:00 h missing → M 12:00–16:00 fits exactly; its 11:40–12:10 break no longer lies inside
    expect(suggestShiftAfter(720, 240, templates)).toEqual({ templateId: 3, start: 720, end: 960, breakStart: null, breakEnd: null })
  })
  it('never suggests a shift that does not count as care staff', () => {
    expect(suggestShiftAfter(840, 120, templates)?.templateId).not.toBe(5)
  })
  it('returns null when no fixed shift ends after the start', () => {
    expect(suggestShiftAfter(1030, 60, templates)).toBeNull()
  })
})
