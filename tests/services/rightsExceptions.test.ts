import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { getActiveUser } from '../../server/services/auth'
import { listRightsExceptions, saveUserRights } from '../../server/services/rights'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addUser, createTestDb, errorCode } from '../helpers/fixtures'

// The column „Sonderrechte“ on the staff list: who was given or lost single switches beyond the role.
describe('listRightsExceptions', () => {
  let db: Db
  let traeger: SessionUser
  let leitung: SessionUser
  let annaEmployee: number
  let anna: SessionUser
  const fresh = (user: SessionUser) => getActiveUser(db, user.id)!

  beforeEach(() => {
    db = createTestDb()
    traeger = addUser(db, 'traeger', 'provider')
    leitung = addUser(db, 'leitung', 'admin')
    annaEmployee = addEmployee(db, 'Anna')
    anna = addUser(db, 'anna', 'observer', annaEmployee)
    addUser(db, 'ben', 'observer', addEmployee(db, 'Ben'))
  })

  it('lists grants with the scope they apply with and revokes, in switch order, only for accounts with exceptions', () => {
    saveUserRights(db, traeger, anna.id, [
      { bundle: 'cashBook', effect: 'grant' }, { bundle: 'childrenEdit', effect: 'grant', scope: 'facility' },
      { bundle: 'calendarView', effect: 'revoke' },
    ])
    expect(listRightsExceptions(db, fresh(traeger), 1)).toEqual([{
      employeeId: annaEmployee,
      overrides: [
        { bundle: 'childrenEdit', effect: 'grant', scope: 'facility' },
        { bundle: 'cashBook', effect: 'grant', scope: null },
        { bundle: 'calendarView', effect: 'revoke', scope: null },
      ],
    }])
  })
  it('lets the Leitung read the exceptions of every account of its facility, also of a Gruppenleitung', () => {
    const gina = addEmployee(db, 'Gina')
    const groupLead = addUser(db, 'gina', 'group_lead', gina)
    saveUserRights(db, traeger, groupLead.id, [{ bundle: 'cashBook', effect: 'grant' }])
    expect(listRightsExceptions(db, fresh(leitung), 1).map(row => row.employeeId)).toEqual([gina])
  })
  it('lists only the facility asked for', () => {
    const krippe = addFacility(db, 'Krippe')
    const kim = addEmployee(db, 'Kim', { facilityId: krippe })
    const kimUser = addUser(db, 'kim', 'observer', kim)
    saveUserRights(db, traeger, kimUser.id, [{ bundle: 'cashBook', effect: 'grant' }])
    saveUserRights(db, traeger, anna.id, [{ bundle: 'cashBook', effect: 'grant' }])
    expect(listRightsExceptions(db, fresh(traeger), krippe).map(row => row.employeeId)).toEqual([kim])
    expect(listRightsExceptions(db, fresh(traeger), 1).map(row => row.employeeId)).toEqual([annaEmployee])
  })
  it('is not for anyone else, even with the staff list (403)', () => {
    const gina = addUser(db, 'gina', 'group_lead', addEmployee(db, 'Gina'))
    expect(errorCode(() => listRightsExceptions(db, fresh(anna), 1))).toBe('forbidden')
    expect(errorCode(() => listRightsExceptions(db, fresh(gina), 1))).toBe('forbidden')
  })
})
