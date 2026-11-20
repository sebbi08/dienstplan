import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { employees, facilities } from '../../server/db/schema'
import { previewClosuresForEmployee, previewClosuresForNew, type ClosurePreviewInput } from '../../server/services/closurePreview'
import { createClosure } from '../../server/services/closures'
import { createEmployee, setEntitlement } from '../../server/services/employees'
import { getLeaveAccount } from '../../server/services/leave'
import { setLeaveCounting } from '../../server/services/leaveCounting'
import type { SessionUser } from '../../shared/types/api'
import { eq } from 'drizzle-orm'
import { addEmployee, addFacility, addUser, createTestDb, errorCode } from '../helpers/fixtures'

// 2026-05-01 (Friday) and 25 December (Friday) are public holidays, 26 December a Saturday.
// Summer: 7 working days Mo–Fr (7, 10–14, 17 August); Christmas: 8 (21–24, 28–31 December), 7 with half eves.
const summer = { startDate: '2026-08-07', endDate: '2026-08-17', label: 'Sommerschließzeit', mode: 'vacation' as const }
const christmas = { startDate: '2026-12-21', endDate: '2026-12-31', label: 'Weihnachten', mode: 'vacation' as const }
const fullTime = { weeklyMinutes: 2340, workdays: 0b0011111, validFrom: '2026-01-01', vacationDays: 30 }

describe('closure leave preview', () => {
  let db: Db
  let admin: SessionUser
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin')
    // These cases count 24 and 31 December as leave days (the facility does not work under the TVöD SuE).
    db.update(facilities).set({ tvoedSue: false }).run()
  })

  /** What creating the person with the same values books (leave days, closure days without leave) in the year. */
  function booked(input: ClosurePreviewInput, year: number) {
    const id = createEmployee(db, admin, 1, { name: 'Neu', shortName: '', ...input })
    const closures = getLeaveAccount(db, id, year, `${year}-01-01`).closures
    return { personDays: closures.reduce((sum, row) => sum + row.days, 0), closureDaysWithoutLeave: closures.reduce((sum, row) => sum + row.closureDays, 0) }
  }

  it('shows the year of „gültig ab“ and the whole coming year for full-time staff', () => {
    createClosure(db, admin, 1, summer)
    createClosure(db, admin, 1, christmas)
    expect(previewClosuresForNew(db, 1, fullTime)).toEqual([
      {
        year: 2026, from: '2026-01-01', hasClosures: true, facilityDays: 15, personDays: 15, closureDaysWithoutLeave: 0,
        entitlementDays: 30, carriedOverDays: 0,
      },
      {
        year: 2027, from: '2027-01-01', hasClosures: false, facilityDays: 0, personDays: 0, closureDaysWithoutLeave: 0,
        entitlementDays: 30, carriedOverDays: 0,
      },
    ])
    expect(booked(fullTime, 2026)).toEqual({ personDays: 15, closureDaysWithoutLeave: 0 })
  })

  it('counts only the working days of a part-time 3-day week (Monday to Wednesday)', () => {
    createClosure(db, admin, 1, summer)
    createClosure(db, admin, 1, christmas)
    const input = { ...fullTime, weeklyMinutes: 1200, workdays: 0b0000111 }
    const [year] = previewClosuresForNew(db, 1, input)
    // Summer: 10–12 and 17 August; Christmas: 21–23 and 28–30 December. The facility figure stays the 5-day week's.
    expect(year).toMatchObject({ facilityDays: 15, personDays: 10, closureDaysWithoutLeave: 0 })
    expect(booked(input, 2026)).toEqual({ personDays: 10, closureDaysWithoutLeave: 0 })
  })

  it('counts a mid-year start only from „gültig ab“ on', () => {
    createClosure(db, admin, 1, { startDate: '2026-04-27', endDate: '2026-04-30', label: 'Frühling', mode: 'vacation' })
    createClosure(db, admin, 1, summer)
    createClosure(db, admin, 1, christmas)
    const input = { ...fullTime, validFrom: '2026-08-12' }
    const [year, coming] = previewClosuresForNew(db, 1, input)
    expect(year).toMatchObject({ year: 2026, from: '2026-08-12', facilityDays: 19, personDays: 12, closureDaysWithoutLeave: 0, entitlementDays: 30 })
    expect(coming).toMatchObject({ year: 2027, from: '2027-01-01', hasClosures: false })
    expect(booked(input, 2026)).toEqual({ personDays: 12, closureDaysWithoutLeave: 0 })
  })

  it('applies the joiner limit as the booking does: the rest become closure days without leave', () => {
    createClosure(db, admin, 1, summer)
    createClosure(db, admin, 1, christmas)
    const input = { ...fullTime, validFrom: '2026-08-01', vacationDays: 2, carriedOverDays: 1 }
    const [year] = previewClosuresForNew(db, 1, input)
    expect(year).toMatchObject({ facilityDays: 15, personDays: 3, closureDaysWithoutLeave: 12, entitlementDays: 2, carriedOverDays: 1 })
    expect(booked(input, 2026)).toEqual({ personDays: 3, closureDaysWithoutLeave: 12 })
  })

  it('does not limit the coming year, and a person without entitlement not at all', () => {
    createClosure(db, admin, 1, summer)
    createClosure(db, admin, 1, { startDate: '2027-08-02', endDate: '2027-08-06', label: 'Sommer 2027', mode: 'vacation' })
    const [, coming] = previewClosuresForNew(db, 1, { ...fullTime, validFrom: '2026-08-01', vacationDays: 2 })
    expect(coming).toMatchObject({ year: 2027, hasClosures: true, facilityDays: 5, personDays: 5, closureDaysWithoutLeave: 0, entitlementDays: 2 })
    const [year] = previewClosuresForNew(db, 1, { ...fullTime, validFrom: '2026-08-01', vacationDays: null })
    expect(year).toMatchObject({ personDays: 7, closureDaysWithoutLeave: 0, entitlementDays: null })
  })

  it('leaves out public holidays inside closures and closures in closure-day mode', () => {
    createClosure(db, admin, 1, { startDate: '2026-04-27', endDate: '2026-05-01', label: 'Maiwoche', mode: 'vacation' })
    createClosure(db, admin, 1, { ...summer, mode: 'closure_day' })
    const [year] = previewClosuresForNew(db, 1, fullTime)
    expect(year).toMatchObject({ hasClosures: true, facilityDays: 4, personDays: 4 })
  })

  it('treats a year with closures in closure-day mode only as one without closures', () => {
    createClosure(db, admin, 1, { ...summer, mode: 'closure_day' })
    expect(previewClosuresForNew(db, 1, fullTime)[0]).toMatchObject({ hasClosures: false, facilityDays: 0, personDays: 0 })
  })

  it('counts 24 and 31 December as half days by the facility setting, also under the joiner limit', () => {
    setLeaveCounting(db, 1, { tvoedSue: false, eveLeave: 'half' }, admin)
    createClosure(db, admin, 1, christmas)
    expect(previewClosuresForNew(db, 1, fullTime)[0]).toMatchObject({ facilityDays: 7, personDays: 7 })
    // 3.5 days: 21–23 December and half of the 24th; the rest without leave.
    const input = { ...fullTime, validFrom: '2026-12-01', vacationDays: 3.5 }
    expect(previewClosuresForNew(db, 1, input)[0]).toMatchObject({ personDays: 3.5, closureDaysWithoutLeave: 4 })
    expect(booked(input, 2026)).toEqual({ personDays: 3.5, closureDaysWithoutLeave: 4 })
  })

  it('splits a closure over the turn of the year into its two years', () => {
    createClosure(db, admin, 1, { startDate: '2026-12-28', endDate: '2027-01-05', label: 'Jahreswechsel', mode: 'vacation' })
    const [year, coming] = previewClosuresForNew(db, 1, fullTime)
    expect(year).toMatchObject({ facilityDays: 4, personDays: 4 })
    // 1 January is a public holiday, 2 and 3 January a weekend.
    expect(coming).toMatchObject({ hasClosures: true, facilityDays: 2, personDays: 2 })
  })

  it('takes the closures of the given facility only and writes nothing', () => {
    const other = addFacility(db, 'Andere')
    createClosure(db, admin, other, summer)
    const before = db.select().from(employees).all().length
    expect(previewClosuresForNew(db, 1, fullTime)[0]).toMatchObject({ hasClosures: false, facilityDays: 0, personDays: 0 })
    expect(db.select().from(employees).all()).toHaveLength(before)
  })

  describe('for an existing employee', () => {
    it('uses the stored hours and entitlement: this year from the start, the whole coming year', () => {
      createClosure(db, admin, 1, summer)
      createClosure(db, admin, 1, { startDate: '2027-08-02', endDate: '2027-08-06', label: 'Sommer 2027', mode: 'vacation' })
      const clara = createEmployee(db, admin, 1, {
        name: 'Clara', shortName: '', weeklyMinutes: 1200, validFrom: '2025-03-01', workdays: 0b0000111, vacationDays: 20, carriedOverDays: 0,
      })
      setEntitlement(db, 1, clara, 2026, { days: 24, carriedOverDays: 0 }, admin)
      const [year, coming] = previewClosuresForEmployee(db, 1, clara, '2026-11-19')
      expect(year).toMatchObject({ year: 2026, from: '2026-01-01', facilityDays: 7, personDays: 4, closureDaysWithoutLeave: 0, entitlementDays: 24 })
      expect(year!.carriedOverDays).toBe(20)
      expect(coming).toMatchObject({ year: 2027, from: '2027-01-01', facilityDays: 5, personDays: 3, entitlementDays: 24, carriedOverDays: 0 })
    })

    it('starts the current year with the first weekly hours and keeps the joiner limit of the booking', () => {
      createClosure(db, admin, 1, summer)
      createClosure(db, admin, 1, christmas)
      const dora = createEmployee(db, admin, 1, { name: 'Dora', shortName: '', weeklyMinutes: 2340, validFrom: '2026-08-01', vacationDays: 2 })
      expect(previewClosuresForEmployee(db, 1, dora, '2026-11-19')[0])
        .toMatchObject({ from: '2026-08-01', personDays: 2, closureDaysWithoutLeave: 13, entitlementDays: 2 })
    })

    it('counts from the move-in day for someone who moved into the facility', () => {
      createClosure(db, admin, 1, summer)
      const anna = addEmployee(db, 'Anna', { validFrom: '2025-01-01' })
      db.update(employees).set({ facilitySince: '2026-08-12' }).where(eq(employees.id, anna)).run()
      expect(previewClosuresForEmployee(db, 1, anna, '2026-11-19')[0]).toMatchObject({ from: '2026-08-12', personDays: 4 })
    })

    it('answers 404 for an employee of another facility', () => {
      const other = addFacility(db, 'Andere')
      const ben = addEmployee(db, 'Ben', { facilityId: other })
      expect(errorCode(() => previewClosuresForEmployee(db, 1, ben, '2026-11-19'))).toBe('employee_not_found')
    })
  })
})
