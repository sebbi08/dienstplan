import { describe, expect, it } from 'vitest'
import { ackKeyDate, warningAckKey, warningSignature } from '../../shared/domain/warningList'
import {
  MAX_DAILY_MINUTES, MIN_REST_MINUTES, exceedsMaxDaily, plannedLawWarnings, plannedWorkMinutes, plannedWorkWindow,
  recordedLawWarnings, recordedWorkWindow, restMinutes, shortRest, usesStampedHints,
} from '../../shared/domain/workingTimeLaw'
import type { DomainEntry } from '../../shared/domain/types'
import { code, shift, special } from '../helpers/entries'

const D = '2026-10-06'
const PREV = '2026-10-05'
const brk = (start: number, end: number): DomainEntry => ({ ...special(1, D, start, end), kind: 'break' })
const home = (start: number, end: number): DomainEntry => ({ ...code(1, D, 'office', 'timed', start, end), homeOffice: true })

describe('§ 3 ArbZG: planned working time per day', () => {
  it('allows exactly 10:00 h and warns from 10:01 h', () => {
    expect(MAX_DAILY_MINUTES).toBe(600)
    expect(plannedWorkMinutes([special(1, D, 420, 1020)])).toBe(600)
    expect(exceedsMaxDaily(600)).toBe(false)
    expect(plannedWorkMinutes([special(1, D, 420, 1021)])).toBe(601)
    expect(exceedsMaxDaily(601)).toBe(true)
  })
  it('leaves out breaks of shifts, additional breaks and the time ranges of Überstundenfrei', () => {
    expect(plannedWorkMinutes([shift(1, D, 420, 1080, 720, 780)])).toBe(600)
    expect(plannedWorkMinutes([special(1, D, 420, 1080), brk(720, 780)])).toBe(600)
    expect(plannedWorkMinutes([special(1, D, 420, 1110), code(1, D, 'overtime_off', 'none', 1020, 1110)])).toBe(600)
  })
  it('counts home office, Büro, VZ and Arzt, overlapping entries once', () => {
    expect(plannedWorkMinutes([special(1, D, 420, 780), home(840, 1141)])).toBe(661)
    expect(plannedWorkMinutes([special(1, D, 420, 900), code(1, D, 'doctor', 'timed', 900, 1080)])).toBe(660)
    expect(plannedWorkMinutes([special(1, D, 420, 1020), code(1, D, 'prep_time', 'timed', 900, 1020)])).toBe(600)
  })
  it('counts Fortbildung and Schule with times as working time (ArbZG), other daily-target codes and codes crediting nothing not', () => {
    expect(plannedWorkMinutes([code(1, D, 'vacation', 'daily_target')])).toBe(0)
    expect(plannedWorkMinutes([code(1, D, 'training', 'daily_target')])).toBe(0)
    expect(plannedWorkMinutes([code(1, D, 'training', 'daily_target', 480, 960), special(1, D, 960, 1200)])).toBe(720)
    expect(plannedWorkMinutes([code(1, D, 'school', 'daily_target', 480, 1081)])).toBe(601)
    expect(plannedWorkMinutes([code(1, D, 'vacation', 'daily_target', 480, 1100), code(1, D, 'sick', 'daily_target', 480, 1100)])).toBe(0)
    expect(plannedWorkMinutes([code(1, D, 'other', 'none', 420, 1100)])).toBe(0)
  })
  it('takes a Fortbildung with times for the rest period', () => {
    expect(plannedLawWarnings(D, 1, [special(1, D, 300, 600)], [code(1, PREV, 'training', 'daily_target', 480, 1140)])).toEqual([
      { type: 'short_rest', date: D, employeeId: 1, from: 1140, to: 300 },
    ])
  })
  it('gives a plan warning above 10 h with the minutes', () => {
    expect(plannedLawWarnings(D, 1, [special(1, D, 420, 1080)], [])).toEqual([
      { type: 'max_hours', date: D, employeeId: 1, minutes: 660 },
    ])
    expect(plannedLawWarnings(D, 1, [shift(1, D, 420, 1080, 720, 780)], [])).toEqual([])
  })
})

describe('§ 5 ArbZG: rest period between two days', () => {
  it('allows exactly 11:00 h and warns at 10:59 h', () => {
    expect(MIN_REST_MINUTES).toBe(660)
    expect(restMinutes(1260, 480)).toBe(660)
    expect(shortRest({ start: 600, end: 1260 }, { start: 480, end: 900 })).toBeNull()
    expect(shortRest({ start: 600, end: 1260 }, { start: 479, end: 900 })).toEqual({ from: 1260, to: 479, minutes: 659 })
  })
  it('takes the end of the last and the start of the first working entry, without times nothing', () => {
    const previous = [special(1, PREV, 600, 900), code(1, PREV, 'prep_time', 'timed', 1140, 1290)]
    const current = [code(1, D, 'office', 'timed', 900, 1000), shift(1, D, 420, 795)]
    expect(plannedWorkWindow(previous)).toEqual({ start: 600, end: 1290 })
    expect(plannedWorkWindow(current)).toEqual({ start: 420, end: 1000 })
    expect(plannedLawWarnings(D, 1, current, previous)).toEqual([{ type: 'short_rest', date: D, employeeId: 1, from: 1290, to: 420 }])
    // Whole-day codes and days without times are ignored.
    expect(plannedWorkWindow([code(1, D, 'office', 'timed')])).toBeNull()
    expect(plannedLawWarnings(D, 1, current, [code(1, PREV, 'vacation', 'daily_target')])).toEqual([])
    expect(plannedLawWarnings(D, 1, [code(1, D, 'sick', 'daily_target')], previous)).toEqual([])
  })
  it('counts Arzt and home office as working time and ends the day before a closing Überstundenfrei', () => {
    expect(plannedWorkWindow([special(1, D, 420, 900), code(1, D, 'doctor', 'timed', 1200, 1260)])).toEqual({ start: 420, end: 1260 })
    expect(plannedWorkWindow([home(390, 600), special(1, D, 600, 900)])).toEqual({ start: 390, end: 900 })
    expect(plannedWorkWindow([special(1, D, 420, 1080), code(1, D, 'overtime_off', 'none', 900, 1080)])).toEqual({ start: 420, end: 900 })
  })
  it('works across midnight up to 24:00 and over a month boundary', () => {
    expect(restMinutes(1440, 0)).toBe(0)
    const october = [special(1, '2026-10-31', 840, 1320)] // 14:00–22:00
    const november = [special(1, '2026-11-01', 420, 780)] // 7:00–13:00
    expect(plannedLawWarnings('2026-11-01', 1, november, october)).toEqual([
      { type: 'short_rest', date: '2026-11-01', employeeId: 1, from: 1320, to: 420 },
    ])
  })
  it('puts the § 3 warning before the § 5 warning', () => {
    expect(plannedLawWarnings(D, 1, [special(1, D, 420, 1100)], [special(1, PREV, 900, 1320)]).map(w => w.type))
      .toEqual(['max_hours', 'short_rest'])
  })
})

describe('stamped working time (Zeiterfassung)', () => {
  const day = (records: { start: number; end: number | null }[], entries: DomainEntry[] = []) => ({ records, entries })

  it('warns from 10:01 h credited time, breaks between records left out', () => {
    expect(recordedLawWarnings(D, 1, day([{ start: 420, end: 720 }, { start: 750, end: 1050 }]), 'stamp', null)).toEqual([])
    expect(recordedLawWarnings(D, 1, day([{ start: 420, end: 720 }, { start: 750, end: 1051 }]), 'stamp', null)).toEqual([
      { type: 'max_hours_recorded', date: D, employeeId: 1, minutes: 601 },
    ])
  })
  it('counts the time credited with automatic breaks and the home office on top of the records', () => {
    // 7:00–18:00 without a clocked break: 11 h minus the legal 45 min = 10:15 h.
    expect(recordedLawWarnings(D, 1, day([{ start: 420, end: 1080 }]), 'auto', null)).toEqual([
      { type: 'max_hours_recorded', date: D, employeeId: 1, minutes: 615 },
    ])
    expect(recordedLawWarnings(D, 1, day([{ start: 420, end: 720 }], [home(780, 1081)]), 'stamp', null)).toEqual([
      { type: 'max_hours_recorded', date: D, employeeId: 1, minutes: 601 },
    ])
  })
  it('takes the rest period from the stamped times, home office and Arzt included, open records left out', () => {
    expect(recordedWorkWindow(day([{ start: 425, end: 700 }, { start: 730, end: null }]))).toEqual({ start: 425, end: 700 })
    expect(recordedWorkWindow(day([{ start: 600, end: 900 }], [home(960, 1290)]))).toEqual({ start: 600, end: 1290 })
    const previous = day([{ start: 780, end: 1291 }])
    expect(recordedLawWarnings(D, 1, day([{ start: 420, end: 700 }]), 'stamp', previous)).toEqual([
      { type: 'short_rest_recorded', date: D, employeeId: 1, from: 1291, to: 420 },
    ])
    expect(recordedLawWarnings(D, 1, day([{ start: 511, end: 700 }]), 'stamp', previous)).toEqual([]) // 8:31: 11:00 h
  })
  it('ignores the stamps of days on which they do not count (a full-day absence or a whole Büro day)', () => {
    const absent = day([{ start: 420, end: 1100 }], [code(1, D, 'vacation', 'daily_target')])
    expect(recordedWorkWindow(absent)).toBeNull()
    expect(recordedLawWarnings(D, 1, absent, 'stamp', day([{ start: 600, end: 1320 }]))).toEqual([])
    expect(recordedLawWarnings(D, 1, day([{ start: 420, end: 700 }]), 'stamp', {
      ...day([{ start: 600, end: 1320 }], [code(1, PREV, 'office', 'timed')]),
    })).toEqual([])
  })
  it('takes the planned times of a Fortbildung on the day before, its stray stamps not', () => {
    const training = day([{ start: 600, end: 1320 }], [code(1, PREV, 'training', 'daily_target', 480, 1140)])
    expect(recordedWorkWindow(training)).toEqual({ start: 480, end: 1140 })
    expect(recordedLawWarnings(D, 1, day([{ start: 300, end: 700 }]), 'stamp', training)).toEqual([
      { type: 'short_rest_recorded', date: D, employeeId: 1, from: 1140, to: 300 },
    ])
  })
  it('decides whether a day uses the stamped hints instead of the planned ones', () => {
    expect(usesStampedHints(day([{ start: 420, end: 700 }]))).toBe(true)
    expect(usesStampedHints(day([]))).toBe(false)
    expect(usesStampedHints(day([{ start: 420, end: null }]))).toBe(false) // only an open record: nothing to compare
    expect(usesStampedHints(day([{ start: 420, end: 700 }], [code(1, D, 'training', 'daily_target', 480, 960)]))).toBe(false)
  })
})

describe('acknowledgements of the working time law warnings', () => {
  it('keys them per person and day, the values as signature', () => {
    const max = { type: 'max_hours', date: D, employeeId: 4, minutes: 615 } as const
    const rest = { type: 'short_rest', date: D, employeeId: 4, from: 1290, to: 420 } as const
    expect([warningAckKey(max), warningSignature(max)]).toEqual([`max_hours|${D}|4`, '615'])
    expect([warningAckKey(rest), warningSignature(rest)]).toEqual([`short_rest|${D}|4`, '1290-420'])
    for (const type of ['max_hours', 'max_hours_recorded', 'short_rest', 'short_rest_recorded']) {
      expect(ackKeyDate(`${type}|${D}|4`)).toBe(D)
      expect(ackKeyDate(`${type}|${D}|x`)).toBeNull()
    }
  })
})
