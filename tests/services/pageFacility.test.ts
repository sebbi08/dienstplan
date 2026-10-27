import { describe, expect, it } from 'vitest'
import { ServiceError } from '../../server/lib/errors'
import { assertPageFacility, requestFacility, settingsFacilityOverride } from '../../server/lib/pageFacility'
import { facilityExists } from '../../server/services/facilities'
import { getOpeningHours, setFacilityOpeningHours } from '../../server/services/openingHours'
import type { SessionUser } from '../../shared/types/api'
import { addFacility, addGroup, createTestDb, errorCode } from '../helpers/fixtures'

function user(role: SessionUser['role'], facilityId: number | null): SessionUser {
  return { id: 1, username: 'x', role, employeeId: null, mustChangePassword: false, facilityId }
}

describe('page facility check (stale Träger window)', () => {
  it('refuses a Träger request from a page loaded for another facility with 409 facility_changed', () => {
    let thrown: unknown
    try {
      assertPageFacility(user('provider', 2), '1')
    }
    catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(ServiceError)
    expect(thrown).toMatchObject({ statusCode: 409, code: 'facility_changed' })
  })
  it('lets the Träger through when the page belongs to the active facility', () => {
    expect(errorCode(() => assertPageFacility(user('provider', 2), '2'))).toBeNull()
  })
  it('does not check requests without the header (PDF rendering, other callers)', () => {
    expect(errorCode(() => assertPageFacility(user('provider', 2), undefined))).toBeNull()
    expect(errorCode(() => assertPageFacility(user('provider', 2), ''))).toBeNull()
  })
  it('checks the Leitung too, whose account can move with its employee', () => {
    expect(errorCode(() => assertPageFacility(user('admin', 2), '1'))).toBe('facility_changed')
    expect(errorCode(() => assertPageFacility(user('admin', 2), '2'))).toBeNull()
  })
  it('never checks tablet or Mitarbeiter accounts', () => {
    expect(errorCode(() => assertPageFacility(user('terminal', 2), '1'))).toBeNull()
    expect(errorCode(() => assertPageFacility(user('observer', 2), '1'))).toBeNull()
  })
})

describe('settings facility of the Träger (settings of another facility without switching)', () => {
  const known = (id: number) => id === 1 || id === 2

  it('gives the Träger the facility the settings page names instead of the active one', () => {
    expect(settingsFacilityOverride(user('provider', 1), '2', known)).toBe(2)
    expect(requestFacility({ ...user('provider', 1), facilityId: 1 }, { page: '1', settings: '2' }, known)).toBe(2)
  })
  it('keeps the active facility without the header or when it names the active one', () => {
    expect(settingsFacilityOverride(user('provider', 1), undefined, known)).toBeNull()
    expect(settingsFacilityOverride(user('provider', 1), ' ', known)).toBeNull()
    expect(settingsFacilityOverride(user('provider', 1), '1', known)).toBeNull()
    expect(requestFacility({ ...user('provider', 1), facilityId: 1 }, { page: '1' }, known)).toBe(1)
  })
  it('ignores the header of every other role (the Leitung edits only its own facility)', () => {
    for (const role of ['admin', 'observer', 'terminal'] as const) {
      expect(settingsFacilityOverride(user(role, 1), '2', known)).toBeNull()
      expect(settingsFacilityOverride(user(role, 1), 'nonsense', known)).toBeNull()
    }
    expect(requestFacility({ ...user('admin', 1), facilityId: 1 }, { page: '1', settings: '2' }, known)).toBe(1)
  })
  it('answers 404 facility_not_found for an id that is no facility', () => {
    for (const header of ['99', 'abc', '0', '1.5']) {
      let thrown: unknown
      try {
        settingsFacilityOverride(user('provider', 1), header, known)
      }
      catch (error) {
        thrown = error
      }
      expect(thrown).toMatchObject({ statusCode: 404, code: 'facility_not_found' })
    }
  })
  it('checks the page against the active facility, not the one whose settings are shown', () => {
    const provider = { ...user('provider', 1), facilityId: 1 }
    // The settings page of facility 1 shows facility 2: no false 409.
    expect(errorCode(() => requestFacility(provider, { page: '1', settings: '2' }, known))).toBeNull()
    // A page loaded for facility 2 (the active one was switched since) is stale, whatever facility it shows.
    expect(errorCode(() => requestFacility(provider, { page: '2', settings: '2' }, known))).toBe('facility_changed')
  })
  it('lets the Träger read the other facility\'s data while the active one stays', () => {
    const db = createTestDb()
    const other = addFacility(db, 'Kita Sonne')
    addGroup(db, other, 'Sonnengruppe')
    const day = { open: 7 * 60, close: 16 * 60, closed: false }
    setFacilityOpeningHours(db, other, { days: [day, day, day, day, day], minAtOpening: 1, minAtClosing: 1 })
    const provider = { ...user('provider', 1), facilityId: 1 }
    const exists = (id: number) => facilityExists(db, id)
    const facilityId = requestFacility(provider, { page: '1', settings: String(other) }, exists)
    expect(facilityId).toBe(other)
    const hours = getOpeningHours(db, facilityId)
    expect(hours.facility?.days[0]).toEqual(day)
    expect(hours.groups.map(group => group.groupName)).toEqual(['Sonnengruppe'])
    expect(getOpeningHours(db, 1).facility?.days[0]).not.toEqual(day)
    expect(errorCode(() => requestFacility(provider, { settings: '999' }, exists))).toBe('facility_not_found')
  })
})
