import { describe, expect, it } from 'vitest'
import { fullShiftOptions, type SuggestDayEntry } from '../../shared/domain/suggest'

const templates = [
  { label: 'F1', start: 420, end: 795, pairsWithPrepTime: false }, // 7:00–13:15
  { label: 'F2', start: 450, end: 945, pairsWithPrepTime: true }, // 7:30–15:45
  { label: 'M', start: 465, end: 960, pairsWithPrepTime: true }, // 7:45–16:00
  { label: 'S', start: 525, end: 1020, pairsWithPrepTime: true }, // 8:45–17:00
  { label: 'HK', start: 660, end: 960, pairsWithPrepTime: false }, // 11:00–16:00
]
const vz = (start: number, end: number): SuggestDayEntry => ({ codeKey: 'prep_time', start, end })
const options = (entries: SuggestDayEntry[]) => fullShiftOptions(entries, templates).map(template => template.label)

describe('fullShiftOptions', () => {
  it('offers every marked shift that encloses the VZ, in template order', () => {
    expect(options([vz(600, 660)])).toEqual(['F2', 'M', 'S']) // VZ 10:00–11:00
  })
  it('offers only the shifts that enclose the VZ', () => {
    expect(options([vz(960, 1020)])).toEqual(['S']) // VZ 16:00–17:00
    expect(options([vz(450, 510)])).toEqual(['F2']) // VZ 7:30–8:30
    expect(options([vz(840, 960)])).toEqual(['M', 'S']) // VZ 14:00–16:00
  })
  it('offers all marked shifts when none encloses the VZ', () => {
    expect(options([vz(420, 450)])).toEqual(['F2', 'M', 'S']) // VZ 7:00–7:30
  })
  it('never offers unmarked shifts (F1, HK)', () => {
    expect(fullShiftOptions([vz(600, 660)], templates.filter(t => !t.pairsWithPrepTime))).toEqual([])
  })
})
