import { describe, expect, it } from 'vitest'
import { ServiceError } from '../../server/lib/errors'
import { assertPageFacility } from '../../server/lib/pageFacility'
import type { SessionUser } from '../../shared/types/api'
import { errorCode } from '../helpers/fixtures'

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
