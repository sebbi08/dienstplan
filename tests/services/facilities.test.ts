import { asc, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { coverageRules, facilities, shiftTemplates, users } from '../../server/db/schema'
import { ServiceError } from '../../server/lib/errors'
import { getActiveUser } from '../../server/services/auth'
import {
  createFacility, listFacilities, resolveFacilityId, setActiveFacility, updateFacility,
} from '../../server/services/facilities'
import { facilityHolidayRules } from '../../server/services/holidayRules'
import { getSchoolSettings, setAutoLeave, setSchoolCutoff } from '../../server/services/schoolChildren'
import { createCoverageRule } from '../../server/services/settings'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addGroup, addUser, createTestDb, errorCode } from '../helpers/fixtures'

function userRow(db: Db, id: number) {
  return db.select().from(users).where(eq(users.id, id)).get()!
}

/** The Träger who changes facilities (created on first use). */
function traeger(db: Db): SessionUser {
  const row = db.select().from(users).where(eq(users.username, 'traeger-einrichtungen')).get()
  return row ? getActiveUser(db, row.id)! : addUser(db, 'traeger-einrichtungen', 'provider')
}

/** Renames only: state and Bavaria flag stay as they are. */
function renameFacility(db: Db, id: number, name: string) {
  const { state, assumptionDay } = facilityHolidayRules(db, id)
  updateFacility(db, traeger(db), id, { name, state, assumptionDay })
}

function shortLabels(db: Db, facilityId: number): string[] {
  return db.select().from(shiftTemplates).where(eq(shiftTemplates.facilityId, facilityId))
    .orderBy(asc(shiftTemplates.sortOrder), asc(shiftTemplates.id)).all().map(template => template.shortLabel)
}

describe('facilities', () => {
  let db: Db
  beforeEach(() => {
    db = createTestDb()
  })

  it('migrates existing data into "Kindergarten"', () => {
    expect(db.select({ id: facilities.id, name: facilities.name }).from(facilities).all())
      .toEqual([{ id: 1, name: 'Kindergarten' }])
    const templates = db.select().from(shiftTemplates).all()
    expect(templates.length).toBeGreaterThan(0)
    expect(templates.every(template => template.facilityId === 1)).toBe(true)
    expect(db.select().from(coverageRules).all().every(rule => rule.facilityId === 1)).toBe(true)
  })

  it('resolves the facility per role', () => {
    const krippe = addFacility(db, 'Krippe')
    const admin = addUser(db, 'leitung', 'admin', null, krippe)
    const terminal = addUser(db, 'tablet', 'terminal', null, krippe)
    expect(resolveFacilityId(db, userRow(db, admin.id))).toBe(krippe)
    expect(resolveFacilityId(db, userRow(db, terminal.id))).toBe(krippe)
    expect(admin.facilityId).toBe(krippe)

    const provider = addUser(db, 'traeger', 'provider')
    expect(resolveFacilityId(db, userRow(db, provider.id))).toBe(1)
    expect(resolveFacilityId(db, { ...userRow(db, provider.id), facilityId: krippe })).toBe(krippe)
    // A selection pointing to a facility that no longer exists falls back to the first facility.
    expect(resolveFacilityId(db, { ...userRow(db, provider.id), facilityId: 999 })).toBe(1)
    expect(resolveFacilityId(db, { ...userRow(db, provider.id), facilityId: null })).toBe(1)

    const anna = addEmployee(db, 'Anna', { facilityId: krippe })
    const observer = addUser(db, 'anna', 'observer', anna)
    expect(userRow(db, observer.id).facilityId).toBeNull()
    expect(resolveFacilityId(db, userRow(db, observer.id))).toBe(krippe)
    expect(observer.facilityId).toBe(krippe)

    const lonely = addUser(db, 'ohne', 'observer')
    expect(resolveFacilityId(db, userRow(db, lonely.id))).toBeNull()
    expect(getActiveUser(db, lonely.id)!.facilityId).toBeNull()
    expect(getActiveUser(db, admin.id)!.facilityId).toBe(krippe)
  })

  it('creates facilities with a copy of shift templates and coverage rules', () => {
    const krippe = createFacility(db, ' Krippe ')
    expect(krippe).toEqual({ id: 2, name: 'Krippe', state: 'BW', assumptionDay: true })
    expect(shortLabels(db, 2)).toEqual(shortLabels(db, 1))
    expect(shortLabels(db, 2).length).toBeGreaterThan(0)
    const rules = (facilityId: number) => db.select().from(coverageRules).where(eq(coverageRules.facilityId, facilityId)).all()
    expect(rules(2).map(rule => rule.label)).toEqual(rules(1).map(rule => rule.label))
    expect(rules(2).length).toBeGreaterThan(0)
    expect(db.select().from(facilities).where(eq(facilities.id, 2)).get())
      .toMatchObject({ timeTrackingFrom: null, leaveMaxConcurrent: null })

    expect(errorCode(() => createFacility(db, 'Krippe'))).toBe('facility_name_taken')
    expect(errorCode(() => createFacility(db, ' krippe '))).toBe('facility_name_taken')
    expect(errorCode(() => createFacility(db, ''))).toBe('facility_name_required')
    expect(errorCode(() => createFacility(db, '   '))).toBe('facility_name_required')
  })

  it('copies only the facility-wide coverage rules, never the first facility\'s group rules', () => {
    const kaefer = addGroup(db, 1, 'Käfer')
    createCoverageRule(db, 1, { label: 'Käfer früh', start: 420, end: null, minCount: 1, active: true, groupId: kaefer })
    const krippe = createFacility(db, 'Krippe').id
    const rules = db.select().from(coverageRules).where(eq(coverageRules.facilityId, krippe)).all()
    expect(rules.map(rule => rule.label)).toEqual(['Spätdienst 8:45–17:00', 'Frühdienst ab 7:00', 'Frühdienst 2 ab 7:30'])
    expect(rules.every(rule => rule.groupId === null)).toBe(true)
  })

  it('renames facilities', () => {
    const krippe = addFacility(db, 'Krippe')
    renameFacility(db, krippe, ' Krippe Sonnenschein ')
    expect(db.select().from(facilities).where(eq(facilities.id, krippe)).get()!.name).toBe('Krippe Sonnenschein')
    renameFacility(db, krippe, 'Krippe Sonnenschein')
    expect(errorCode(() => renameFacility(db, krippe, 'Kindergarten'))).toBe('facility_name_taken')
    expect(errorCode(() => renameFacility(db, krippe, ' '))).toBe('facility_name_required')
    expect(errorCode(() => renameFacility(db, 999, 'Hort'))).toBe('facility_not_found')
  })

  describe('state', () => {
    it('a new facility takes the cutoff of its state', () => {
      const nord = createFacility(db, 'Krippe Nord', 'TH').id
      expect(facilityHolidayRules(db, nord).state).toBe('TH')
      expect(getSchoolSettings(db, nord)).toMatchObject({ cutoffMonth: 8, cutoffDay: 1, ageYears: 6 })
      const sued = createFacility(db, 'Krippe Süd').id
      expect(facilityHolidayRules(db, sued).state).toBe('BW')
      expect(getSchoolSettings(db, sued)).toMatchObject({ cutoffMonth: 6, cutoffDay: 30, ageYears: 6 })
      expect(errorCode(() => createFacility(db, 'Krippe Ost', 'XX' as never))).toBe('state_invalid')
      expect(db.select().from(facilities).all().map(f => f.name)).not.toContain('Krippe Ost')
    })

    it('changing the state keeps the cutoff and the switch', () => {
      setAutoLeave(db, 1, true, '2026-01-01')
      expect(getSchoolSettings(db, 1)).toMatchObject({ cutoffMonth: 6, cutoffDay: 30, autoLeave: true })
      updateFacility(db, traeger(db), 1, { name: 'Kindergarten', state: 'NW', assumptionDay: true })
      expect(getSchoolSettings(db, 1)).toEqual({
        cutoffMonth: 6, cutoffDay: 30, ageYears: 6, autoLeave: true,
        stateCutoff: { cutoffMonth: 9, cutoffDay: 30, ageYears: 6 },
      })
    })

    it('rejects an unknown state and stores nothing', () => {
      expect(errorCode(() => updateFacility(db, traeger(db), 1, { name: 'Neu', state: 'XX' as never, assumptionDay: false }))).toBe('state_invalid')
      expect(db.select().from(facilities).get()).toMatchObject({ name: 'Kindergarten', state: 'BW', assumptionDay: true })
    })

    it('stores the Bavaria flag', () => {
      updateFacility(db, traeger(db), 1, { name: 'Kindergarten', state: 'BY', assumptionDay: false })
      expect(facilityHolidayRules(db, 1)).toEqual({ state: 'BY', assumptionDay: false })
    })

    it('adopting the state cutoff is a normal cutoff change that switches the automatic leaving off', () => {
      setAutoLeave(db, 1, true, '2026-01-01')
      updateFacility(db, traeger(db), 1, { name: 'Kindergarten', state: 'NW', assumptionDay: true })
      const { settings, autoLeaveSwitchedOff } = setSchoolCutoff(db, 1, getSchoolSettings(db, 1).stateCutoff)
      expect(autoLeaveSwitchedOff).toBe(true)
      expect(settings).toMatchObject({ cutoffMonth: 9, cutoffDay: 30, autoLeave: false })
    })
  })

  it('compares names case-insensitively including umlauts', () => {
    const aue = addFacility(db, 'Kita Äußere Au')
    expect(errorCode(() => createFacility(db, ' kita äußere au '))).toBe('facility_name_taken')
    expect(errorCode(() => createFacility(db, 'KITA ÄUßERE AU'))).toBe('facility_name_taken')
    const other = addFacility(db, 'Hort Österfeld')
    expect(errorCode(() => renameFacility(db, aue, 'HORT ÖSTERFELD'))).toBe('facility_name_taken')
    expect(errorCode(() => renameFacility(db, other, 'hort österfeld'))).toBeNull()
  })

  it('lists facilities per role', () => {
    const krippe = addFacility(db, 'Krippe')
    const provider = addUser(db, 'traeger', 'provider')
    expect(listFacilities(db, provider)).toEqual({
      facilities: [
        { id: 1, name: 'Kindergarten', state: 'BW', assumptionDay: true },
        { id: krippe, name: 'Krippe', state: 'BW', assumptionDay: true },
      ],
      activeId: 1,
    })
    const admin = addUser(db, 'leitung', 'admin', null, krippe)
    expect(listFacilities(db, admin)).toEqual({
      facilities: [{ id: krippe, name: 'Krippe', state: 'BW', assumptionDay: true }], activeId: krippe,
    })
  })

  it('switches the active facility for the Träger only', () => {
    const krippe = addFacility(db, 'Krippe')
    const provider = addUser(db, 'traeger', 'provider')
    setActiveFacility(db, provider, krippe)
    expect(getActiveUser(db, provider.id)!.facilityId).toBe(krippe)

    const admin = addUser(db, 'leitung', 'admin')
    let error: unknown = null
    try {
      setActiveFacility(db, admin, krippe)
    }
    catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(ServiceError)
    expect(error).toMatchObject({ statusCode: 403, code: 'forbidden' })
    expect(getActiveUser(db, admin.id)!.facilityId).toBe(1)

    expect(errorCode(() => setActiveFacility(db, provider, 999))).toBe('facility_not_found')
    expect(getActiveUser(db, provider.id)!.facilityId).toBe(krippe)
  })
})
