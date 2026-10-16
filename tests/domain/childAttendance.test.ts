import { describe, expect, it } from 'vitest'
import {
  countsForMeal, dayStatus, monthCell, monthSums, OVERDUE_MINUTES, personKey, pickupLogValue, pickupOverdue, readPickupLogValue, sameName,
  staysOverlap,
} from '../../shared/domain/childAttendance'
import type { AttendanceStatus } from '../../shared/types/api'

const open = (arrived: number) => ({ arrived, left: null })
const closed = (arrived: number, left: number) => ({ arrived, left })

const status = (over: Partial<Parameters<typeof dayStatus>[0]> = {}) =>
  dayStatus({ stays: [], absence: null, date: '2026-10-14', today: '2026-10-15', isCareDay: true, recordedFrom: '2026-10-01', ...over })

describe('dayStatus', () => {
  it('is present while any stay is open', () => {
    expect(status({ stays: [open(465)] })).toBe('present')
    expect(status({ stays: [closed(465, 600), open(660)] })).toBe('present')
  })
  it('is gone once all stays are closed', () => {
    expect(status({ stays: [closed(465, 900)] })).toBe('gone')
    expect(status({ stays: [closed(465, 600), closed(660, 900)] })).toBe('gone')
  })
  it('returns the absence kind when the child never came', () => {
    expect(status({ absence: 'sick' })).toBe('sick')
    expect(status({ absence: 'vacation' })).toBe('vacation')
    expect(status({ absence: 'excused' })).toBe('excused')
  })
  it('is unexcused on a past care day with nothing entered', () => {
    expect(status()).toBe('unexcused')
  })
  it('is not_yet on a past non-care day, today and future days', () => {
    expect(status({ isCareDay: false })).toBe('not_yet')
    expect(status({ date: '2026-10-15' })).toBe('not_yet')
    expect(status({ date: '2026-10-16' })).toBe('not_yet')
  })
  it('lets a stay beat an absence', () => {
    expect(status({ stays: [open(465)], absence: 'sick' })).toBe('present')
    expect(status({ stays: [closed(465, 900)], absence: 'sick' })).toBe('gone')
  })
  it('lets an absence beat unexcused', () => {
    expect(status({ absence: 'vacation', isCareDay: true })).toBe('vacation')
  })
  it('is never unexcused before attendance was recorded, or while it never was', () => {
    expect(status({ recordedFrom: '2026-10-14' })).toBe('unexcused')
    expect(status({ recordedFrom: '2026-10-15' })).toBe('not_yet')
    expect(status({ recordedFrom: null })).toBe('not_yet')
    // Entries before that day still show.
    expect(status({ recordedFrom: null, absence: 'sick' })).toBe('sick')
    expect(status({ recordedFrom: '2026-10-15', stays: [closed(465, 900)] })).toBe('gone')
  })
})

describe('staysOverlap', () => {
  it('finds stays sharing some time; an open stay lasts the rest of the day', () => {
    expect(staysOverlap(closed(480, 600), closed(590, 700))).toBe(true)
    expect(staysOverlap(closed(480, 700), closed(500, 600))).toBe(true)
    expect(staysOverlap(open(480), closed(600, 700))).toBe(true)
    expect(staysOverlap(closed(480, 600), open(599))).toBe(true)
    expect(staysOverlap(open(480), open(600))).toBe(true)
  })
  it('lets stays touch', () => {
    expect(staysOverlap(closed(480, 600), closed(600, 700))).toBe(false)
    expect(staysOverlap(closed(480, 600), open(600))).toBe(false)
    expect(staysOverlap(closed(600, 700), closed(480, 590))).toBe(false)
  })
})

describe('countsForMeal', () => {
  const meal = 570
  it('counts a child who is there at the meal time or planned to be', () => {
    expect(countsForMeal(meal, [open(570)], 720, null)).toBe(true)
    expect(countsForMeal(meal, [open(480)], null, null)).toBe(true)
  })
  it('does not count a child who arrives after the meal', () => {
    expect(countsForMeal(meal, [open(571)], 720, null)).toBe(false)
  })
  it('uses the real departure for closed stays', () => {
    expect(countsForMeal(meal, [closed(480, 570)], 720, null)).toBe(false)
    expect(countsForMeal(meal, [closed(480, 571)], 720, null)).toBe(true)
  })
  it('does not count an open stay whose planned pickup is at or before the meal', () => {
    expect(countsForMeal(meal, [open(480)], 570, null)).toBe(false)
    expect(countsForMeal(meal, [open(480)], 500, null)).toBe(false)
  })
  it('does not count a child without stays', () => {
    expect(countsForMeal(meal, [], 720, null)).toBe(false)
  })
  it('counts when any of several stays covers the meal', () => {
    expect(countsForMeal(meal, [closed(420, 500), open(560)], 900, null)).toBe(true)
  })
  it('lets the manual value win', () => {
    expect(countsForMeal(meal, [open(480)], 720, false)).toBe(false)
    expect(countsForMeal(meal, [], null, true)).toBe(true)
  })
})

describe('pickupOverdue', () => {
  it('uses a 15 minute tolerance', () => {
    expect(OVERDUE_MINUTES).toBe(15)
    expect(pickupOverdue([open(465)], 900, true, 914)).toBe(false)
    expect(pickupOverdue([open(465)], 900, true, 915)).toBe(true)
  })
  it('is false for closed stays, other days and without planned pickup', () => {
    expect(pickupOverdue([closed(465, 880)], 900, true, 1000)).toBe(false)
    expect(pickupOverdue([open(465)], 900, false, 1000)).toBe(false)
    expect(pickupOverdue([open(465)], null, true, 1000)).toBe(false)
    expect(pickupOverdue([], 900, true, 1000)).toBe(false)
  })
})

describe('month cells', () => {
  it('maps statuses to cells', () => {
    expect(monthCell('present')).toBe('present')
    expect(monthCell('gone')).toBe('present')
    expect(monthCell('not_yet')).toBe('none')
    expect(monthCell('sick')).toBe('sick')
    expect(monthCell('vacation')).toBe('vacation')
    expect(monthCell('excused')).toBe('excused')
    expect(monthCell('unexcused')).toBe('unexcused')
  })
  it('sums a mixed list and ignores empty cells', () => {
    const statuses: AttendanceStatus[] = ['present', 'gone', 'gone', 'sick', 'sick', 'vacation', 'excused', 'unexcused', 'not_yet']
    expect(monthSums(statuses.map(monthCell))).toEqual({ present: 3, sick: 2, vacation: 1, excused: 1, unexcused: 1 })
    expect(monthSums([])).toEqual({ present: 0, sick: 0, vacation: 0, excused: 0, unexcused: 0 })
  })
})

describe('person names', () => {
  it('compares names trimmed, with single spaces and in any case', () => {
    expect(personKey('  Max   MEIER ')).toBe('max meier')
    expect(sameName(['Anna Meier', 'Opa Karl'], ' opa  karl')).toBe('Opa Karl')
    expect(sameName(['Anna Meier', 'Opa Karl'], 'Opa Karla')).toBeUndefined()
    expect(sameName(['Opa Karl'], '   ')).toBeUndefined()
  })
})

describe('the pickup person in the history', () => {
  it('logs a registered person by the plain name and nobody as empty', () => {
    expect(pickupLogValue({ name: 'Anna Meier', other: false, confirmedWith: '' })).toBe('Anna Meier')
    expect(pickupLogValue({ name: null, other: false, confirmedWith: '' })).toBe('')
    expect(readPickupLogValue('Anna Meier')).toEqual({ name: 'Anna Meier', other: false, confirmedWith: '' })
    expect(readPickupLogValue('')).toBeNull()
  })

  it('marks a person typed by hand, with the "Rücksprache mit", so both sides of a change show it', () => {
    const logged = pickupLogValue({ name: 'Tante Uta', other: true, confirmedWith: 'Mama, telefonisch' })
    expect(logged).not.toBe('Tante Uta')
    expect(readPickupLogValue(logged)).toEqual({ name: 'Tante Uta', other: true, confirmedWith: 'Mama, telefonisch' })
    expect(readPickupLogValue(pickupLogValue({ name: 'Rosa', other: true, confirmedWith: '' })))
      .toEqual({ name: 'Rosa', other: true, confirmedWith: '' })
    // A name that only looks like the mark stays a name.
    expect(readPickupLogValue('{"other": nicht')).toEqual({ name: '{"other": nicht', other: false, confirmedWith: '' })
  })
})
