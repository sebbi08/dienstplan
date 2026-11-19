import { describe, expect, it } from 'vitest'
import {
  fromWindowDrafts, noAutoLockNote, sameWindowDrafts, toNoLockPeriods, toWindowDrafts,
} from '../../app/utils/tabletWindows'

describe('the settings form of the windows without the automatic lock', () => {
  it('shows stored windows as clock times and reads them back', () => {
    const drafts = toWindowDrafts([{ start: 450, end: 510 }, { start: 900, end: 1440 }])
    expect(drafts).toEqual([{ start: '7:30', end: '8:30' }, { start: '15:00', end: '24:00' }])
    expect(fromWindowDrafts(drafts)).toEqual({ windows: [{ start: 450, end: 510 }, { start: 900, end: 1440 }], problem: null })
    expect(fromWindowDrafts([])).toEqual({ windows: [], problem: null })
  })

  it('counts differently typed times as unchanged', () => {
    expect(sameWindowDrafts([{ start: '7:30', end: '8:30' }], [{ start: '730', end: '8.30' }])).toBe(true)
    expect(sameWindowDrafts([{ start: '7:30', end: '8:30' }], [{ start: '7:30', end: '8:35' }])).toBe(false)
    expect(sameWindowDrafts([], [{ start: '7:30', end: '8:30' }])).toBe(false)
  })

  it('names the wrong row with a German text', () => {
    expect(fromWindowDrafts([{ start: '7:30', end: '' }]).problem)
      .toEqual({ row: 1, text: 'Bitte bei jedem Zeitraum „Von“ und „Bis“ als Uhrzeit eingeben (0:00 bis 24:00) oder den Zeitraum entfernen.' })
    expect(fromWindowDrafts([{ start: '7:30', end: '8:00' }, { start: '9:00', end: '8:00' }]).problem)
      .toEqual({ row: 2, text: 'Bei einem Zeitraum ohne automatische Sperre muss „Bis“ nach „Von“ liegen.' })
    expect(fromWindowDrafts([{ start: '7:30', end: '9:00' }, { start: '8:00', end: '8:30' }]).problem)
      .toEqual({ row: 2, text: 'Die Zeiträume ohne automatische Sperre dürfen sich nicht überschneiden.' })
    expect(fromWindowDrafts(Array.from({ length: 7 }, (_, index) => ({ start: `${index + 1}:00`, end: `${index + 1}:30` }))).problem)
      .toEqual({ row: null, text: 'Es sind höchstens 6 Zeiträume ohne automatische Sperre möglich.' })
  })
})

describe('the note in the unlock bar', () => {
  const periods = toNoLockPeriods([{ from: '2026-10-06T05:30:00.000Z', until: '2026-10-06T06:30:00.000Z' }])

  it('names the end of the running window in Berlin time', () => {
    expect(noAutoLockNote(periods, Date.parse('2026-10-06T06:00:00.000Z'))).toBe('ohne automatische Sperre bis 8:30')
  })

  it('says nothing outside a window', () => {
    expect(noAutoLockNote(periods, Date.parse('2026-10-06T06:30:00.000Z'))).toBeNull()
    expect(noAutoLockNote([], Date.parse('2026-10-06T06:00:00.000Z'))).toBeNull()
  })

  it('names midnight as 24:00', () => {
    const late = toNoLockPeriods([{ from: '2026-10-06T19:00:00.000Z', until: '2026-10-06T22:00:00.000Z' }])
    expect(noAutoLockNote(late, Date.parse('2026-10-06T21:00:00.000Z'))).toBe('ohne automatische Sperre bis 24:00')
  })
})
