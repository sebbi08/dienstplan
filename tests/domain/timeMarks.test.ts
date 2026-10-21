import { describe, expect, it } from 'vitest'
import { dayMarks, summarizeMarks } from '../../shared/domain/timeMarks'
import { code, shift } from '../helpers/entries'

const D = '2026-10-06'
const M = shift(1, D, 465, 960, 700, 730) // 7:45–16:00
const options = { tolerance: 5, markEarly: true }

describe('late arrival and early leave of a day', () => {
  it('marks nothing on time', () => {
    expect(dayMarks([M], [{ start: 465, end: 960 }], options)).toEqual({ lateMinutes: null, earlyMinutes: null })
    expect(dayMarks([M], [{ start: 440, end: 990 }], options)).toEqual({ lateMinutes: null, earlyMinutes: null })
  })

  it('marks nothing within the tolerance (up to and including it)', () => {
    expect(dayMarks([M], [{ start: 470, end: 955 }], options)).toEqual({ lateMinutes: null, earlyMinutes: null })
  })

  it('marks a delay and an early leave just over the tolerance', () => {
    expect(dayMarks([M], [{ start: 471, end: 954 }], options)).toEqual({ lateMinutes: 6, earlyMinutes: 6 })
  })

  it('marks every minute with a tolerance of 0', () => {
    expect(dayMarks([M], [{ start: 466, end: 959 }], { tolerance: 0, markEarly: true })).toEqual({ lateMinutes: 1, earlyMinutes: 1 })
  })

  it('leaves early leaving unmarked when the facility switched it off', () => {
    expect(dayMarks([M], [{ start: 480, end: 900 }], { tolerance: 5, markEarly: false })).toEqual({ lateMinutes: 15, earlyMinutes: null })
  })

  it('compares the first arrival with the first planned start and the last departure with the last planned end', () => {
    const split = [shift(1, D, 420, 600), shift(1, D, 840, 1020)] // 7:00–10:00 and 14:00–17:00
    // Late into the second part and early out of the first part do not count – only the edges of the day.
    expect(dayMarks(split, [{ start: 420, end: 590 }, { start: 860, end: 1020 }], options)).toEqual({ lateMinutes: null, earlyMinutes: null })
    expect(dayMarks(split, [{ start: 860, end: 1020 }, { start: 430, end: 600 }], options)).toEqual({ lateMinutes: 10, earlyMinutes: null })
    expect(dayMarks(split, [{ start: 420, end: 600 }, { start: 840, end: 1000 }], options)).toEqual({ lateMinutes: null, earlyMinutes: 20 })
  })

  it('counts timed codes (VZ, Büro) as planned work, never breaks', () => {
    const vz = code(1, D, 'prep_time', 'timed', 420, 465) // VZ 7:00–7:45 before the shift
    expect(dayMarks([M, vz], [{ start: 465, end: 960 }], options).lateMinutes).toBe(45)
    const pause = { ...shift(1, D, 400, 465), kind: 'break' as const }
    expect(dayMarks([M, pause], [{ start: 465, end: 960 }], options).lateMinutes).toBeNull()
  })

  it('marks nothing without planned work or without stamps', () => {
    expect(dayMarks([], [{ start: 600, end: 700 }], options)).toEqual({ lateMinutes: null, earlyMinutes: null })
    expect(dayMarks([code(1, D, 'prep_time', 'none')], [{ start: 600, end: 700 }], options)).toEqual({ lateMinutes: null, earlyMinutes: null })
    expect(dayMarks([M], [], options)).toEqual({ lateMinutes: null, earlyMinutes: null })
  })

  it('marks nothing on a day with an absence or another code crediting the daily target', () => {
    expect(dayMarks([code(1, D, 'sick', 'daily_target')], [{ start: 600, end: 700 }], options)).toEqual({ lateMinutes: null, earlyMinutes: null })
    expect(dayMarks([M, code(1, D, 'training', 'daily_target')], [{ start: 600, end: 700 }], options)).toEqual({ lateMinutes: null, earlyMinutes: null })
  })

  it('marks no early leave while a stay is open, but a late arrival at once', () => {
    expect(dayMarks([M], [{ start: 480, end: null }], options)).toEqual({ lateMinutes: 15, earlyMinutes: null })
    expect(dayMarks([M], [{ start: 465, end: 700 }, { start: 730, end: null }], options).earlyMinutes).toBeNull()
  })

  it('today marks early leaving only once the planned end has passed (a stamped break is no departure)', () => {
    const records = [{ start: 480, end: 700 }]
    expect(dayMarks([M], records, { ...options, now: 710 })).toEqual({ lateMinutes: 15, earlyMinutes: null })
    expect(dayMarks([M], records, { ...options, now: 960 })).toEqual({ lateMinutes: 15, earlyMinutes: 260 })
  })

  it('ends the duty at an earlier closing of the facility for early leaving (not for late arrivals)', () => {
    const closing = { ...options, closedFrom: 840 } // closed from 14:00, M until 16:00
    expect(dayMarks([M], [{ start: 465, end: 845 }], closing)).toEqual({ lateMinutes: null, earlyMinutes: null })
    expect(dayMarks([M], [{ start: 465, end: 835 }], closing)).toEqual({ lateMinutes: null, earlyMinutes: null }) // within 5
    expect(dayMarks([M], [{ start: 480, end: 810 }], closing)).toEqual({ lateMinutes: 15, earlyMinutes: 30 })
    // A closing after the planned end changes nothing.
    expect(dayMarks([M], [{ start: 465, end: 900 }], { ...options, closedFrom: 1000 }).earlyMinutes).toBe(60)
    // Today the earlier end also decides when early leaving can be marked.
    expect(dayMarks([M], [{ start: 465, end: 810 }], { ...closing, now: 840 }).earlyMinutes).toBe(30)
  })

  it('evaluates the times it is given, i.e. the corrected ones', () => {
    const stamped = [{ start: 500, end: 960 }]
    expect(dayMarks([M], stamped, options).lateMinutes).toBe(35)
    const corrected = [{ start: 465, end: 960 }] // the Leitung fixed a late stamp
    expect(dayMarks([M], corrected, options).lateMinutes).toBeNull()
  })

  it('sums the marks of a month', () => {
    const days = [
      { lateMinutes: 10, earlyMinutes: null }, { lateMinutes: null, earlyMinutes: null },
      { lateMinutes: 7, earlyMinutes: 30 }, { lateMinutes: null, earlyMinutes: 15 },
    ]
    expect(summarizeMarks(days)).toEqual({ lateCount: 2, lateMinutes: 17, earlyCount: 2, earlyMinutes: 45 })
    expect(summarizeMarks([])).toEqual({ lateCount: 0, lateMinutes: 0, earlyCount: 0, earlyMinutes: 0 })
  })
})
