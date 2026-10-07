import { asc, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { coverageRules, facilities, shiftTemplates, users } from '../../server/db/schema'
import { ServiceError } from '../../server/lib/errors'
import { getActiveUser } from '../../server/services/auth'
import {
  createFacility, listFacilities, renameFacility, resolveFacilityId, setActiveFacility,
} from '../../server/services/facilities'
import { addEmployee, addFacility, addUser, createTestDb, errorCode } from '../helpers/fixtures'

function userRow(db: Db, id: number) {
  return db.select().from(users).where(eq(users.id, id)).get()!
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
    expect(krippe).toEqual({ id: 2, name: 'Krippe' })
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

  it('renames facilities', () => {
    const krippe = addFacility(db, 'Krippe')
    renameFacility(db, krippe, ' Krippe Sonnenschein ')
    expect(db.select().from(facilities).where(eq(facilities.id, krippe)).get()!.name).toBe('Krippe Sonnenschein')
    renameFacility(db, krippe, 'Krippe Sonnenschein')
    expect(errorCode(() => renameFacility(db, krippe, 'Kindergarten'))).toBe('facility_name_taken')
    expect(errorCode(() => renameFacility(db, krippe, ' '))).toBe('facility_name_required')
    expect(errorCode(() => renameFacility(db, 999, 'Hort'))).toBe('facility_not_found')
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
      facilities: [{ id: 1, name: 'Kindergarten' }, { id: krippe, name: 'Krippe' }], activeId: 1,
    })
    const admin = addUser(db, 'leitung', 'admin', null, krippe)
    expect(listFacilities(db, admin)).toEqual({ facilities: [{ id: krippe, name: 'Krippe' }], activeId: krippe })
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
