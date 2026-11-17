import { describe, expect, it } from 'vitest'
import { describeCellDetailed } from '../../shared/domain/describe'
import { cellIdentity } from '../../shared/domain/releaseDiff'
import { dayCreditedMinutes, homeOfficeMinutes, isHomeOffice } from '../../shared/domain/stamping'
import { dayMarks } from '../../shared/domain/timeMarks'
import { timeWarnings } from '../../shared/domain/warnings'
import { code, shift, special } from '../helpers/entries'

const D = '2026-10-06'
const home = (start: number, end: number, breakStart: number | null = null, breakEnd: number | null = null) =>
  shift(1, D, start, end, breakStart, breakEnd, { kind: 'special', homeOffice: true })
const records = (...spans: [number, number | null][]) => spans.map(([start, end]) => ({ start, end }))

describe('home-office entries', () => {
  it('are working entries with times marked as home office', () => {
    expect(isHomeOffice(home(1200, 1230))).toBe(true)
    expect(isHomeOffice(special(1, D, 1200, 1230))).toBe(false)
    expect(isHomeOffice({ ...code(1, D, 'office', 'timed', 900, 960), homeOffice: true })).toBe(true)
    expect(isHomeOffice({ ...code(1, D, 'sick', 'daily_target'), homeOffice: true })).toBe(false)
  })

  it('count their minutes without records, without planned breaks inside them', () => {
    expect(homeOfficeMinutes([home(1200, 1230)], [])).toBe(30)
    expect(homeOfficeMinutes([home(480, 840, 720, 750)], [])).toBe(330)
    const extraBreak = shift(1, D, 600, 615, null, null, { kind: 'break', countsAsStaff: false })
    expect(homeOfficeMinutes([home(480, 720), extraBreak], [])).toBe(225)
    expect(homeOfficeMinutes([special(1, D, 480, 720)], [])).toBe(0)
  })

  it('count minutes also covered by a closed record only once (as recorded)', () => {
    expect(homeOfficeMinutes([home(1200, 1230)], records([465, 960]))).toBe(30)
    expect(homeOfficeMinutes([home(900, 1020)], records([465, 960]))).toBe(60)
    expect(homeOfficeMinutes([home(900, 1020)], records([465, null]))).toBe(120)
  })

  it('add to the credited clocked time of the day', () => {
    const day = [shift(1, D, 465, 960, 700, 730), home(1200, 1230)]
    expect(dayCreditedMinutes(records([465, 960]), day, 'stamp')).toBe(495 + 30)
    // Automatic breaks: the shift's break is deducted from the clocked part, the home office keeps its 30 minutes.
    expect(dayCreditedMinutes(records([465, 960]), day, 'auto')).toBe(465 + 30)
    expect(dayCreditedMinutes([], [home(1200, 1230)], 'auto')).toBe(30)
    // The break of the home-office entry is not deducted a second time from the clocked part.
    expect(dayCreditedMinutes(records([465, 700]), [special(1, D, 465, 700), home(800, 1000, 900, 930)], 'auto'))
      .toBe(235 + 170)
    expect(dayCreditedMinutes(records([465, 960]), [shift(1, D, 465, 960, 700, 730)], 'auto')).toBe(465)
  })

  it('need no records: no missing_record for a day with only home office', () => {
    expect(timeWarnings(D, 1, [home(1200, 1230)], [])).toEqual([])
    expect(timeWarnings(D, 1, [shift(1, D, 465, 960, 700, 730), home(1200, 1230)], []).map(w => w.type)).toEqual(['missing_record'])
    expect(timeWarnings(D, 1, [], records([465, 700])).map(w => w.type)).toEqual(['record_without_plan'])
  })

  it('are left out when arrival and departure are compared with the plan', () => {
    const day = [shift(1, D, 465, 960, 700, 730), home(1200, 1230)]
    expect(dayMarks(day, records([465, 960]), { tolerance: 5, markEarly: true })).toEqual({ lateMinutes: null, earlyMinutes: null })
    expect(dayMarks([home(1200, 1230)], records([465, 700]), { tolerance: 5, markEarly: true }))
      .toEqual({ lateMinutes: null, earlyMinutes: null })
  })

  it('are named in the cell text and the release identity', () => {
    const entry = { shortLabel: null, label: '20:00–20:30', breakStart: null, breakEnd: null, note: 'Elternbriefe' }
    expect(describeCellDetailed([{ ...entry, homeOffice: true }])).toBe('20:00–20:30 (Homeoffice) · Elternbriefe')
    expect(describeCellDetailed([entry])).toBe('20:00–20:30 · Elternbriefe')
    const snapshot = { ...entry, employeeId: 1, date: D, kind: 'special' as const, codeId: null, start: 1200, end: 1230, countsAsStaff: true }
    expect(cellIdentity([{ ...snapshot, homeOffice: true }])).not.toBe(cellIdentity([snapshot]))
    expect(cellIdentity([{ ...snapshot, homeOffice: false }])).toBe(cellIdentity([snapshot]))
  })
})
