import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { careTypes, children, employees, facilities, groups } from '../../server/db/schema'
import { setFacilityOpeningHours } from '../../server/services/openingHours'
import { getSetupChecklist, hideSetupItem, showSetupItem } from '../../server/services/setupChecklist'
import type { SessionUser } from '../../shared/types/api'
import { addChild, addEmployee, addFacility, addGroup, addUser, createTestDb, errorCode } from '../helpers/fixtures'

const now = new Date('2026-10-25T08:00:00.000Z')
const openKeys = (db: Db, user: SessionUser, facilityId = 1) => getSetupChecklist(db, user, facilityId, now).open.map(item => item.key)

describe('setup checklist service', () => {
  let db: Db
  let leitung: SessionUser
  let traeger: SessionUser
  let anna: number
  beforeEach(() => {
    db = createTestDb()
    anna = addEmployee(db, 'Anna')
    leitung = addUser(db, 'leitung', 'admin', anna)
    traeger = addUser(db, 'traeger', 'provider')
  })

  it('refuses a Mitarbeiter account', () => {
    const staff = addUser(db, 'mitarbeiter', 'observer', addEmployee(db, 'Berta'))
    expect(errorCode(() => getSetupChecklist(db, staff, 1, now))).toBe('forbidden')
    expect(errorCode(() => hideSetupItem(db, staff, 1, 'employee_birthday', now))).toBe('forbidden')
    expect(errorCode(() => showSetupItem(db, staff, 1, 'employee_birthday'))).toBe('forbidden')
  })

  it('gathers the facts of the facility, and items disappear once fixed', () => {
    const checklist = getSetupChecklist(db, traeger, 1, now)
    expect(checklist.open.map(item => item.key)).toEqual([
      'opening_hours', 'terminal_account', 'facility_capacity', 'employee_qualification', 'employee_birthday',
    ])
    expect(checklist.open.find(item => item.key === 'employee_birthday')).toMatchObject({
      area: 'staff', count: 1, names: [{ name: 'Anna', to: `/admin/employees/${anna}?tab=master` }],
    })

    setFacilityOpeningHours(db, 1, {
      days: Array.from({ length: 5 }, () => ({ open: 420, close: 960, closed: false })), minAtOpening: 1, minAtClosing: 1,
    })
    addUser(db, 'tablet', 'terminal')
    db.update(facilities).set({ capacity: 60 }).where(eq(facilities.id, 1)).run()
    db.update(employees).set({ qualification: 'fachkraft', birthday: '04-12' }).where(eq(employees.id, anna)).run()
    expect(openKeys(db, traeger)).toEqual([])
  })

  it('leaves out the items for the Träger only for the Leitung', () => {
    expect(openKeys(db, traeger)).toContain('facility_capacity')
    expect(openKeys(db, leitung)).not.toContain('facility_capacity')
    expect(errorCode(() => hideSetupItem(db, leitung, 1, 'facility_capacity', now))).toBe('forbidden')
  })

  it('asks for PINs only while time tracking is on and ignores staff who left', () => {
    addEmployee(db, 'Berta')
    addEmployee(db, 'Clara', { leftOn: '2026-09-30' })
    db.insert(employees).values({ name: 'Dora', facilityId: 1, sortOrder: 99, pinHash: 'x', pinLockLevel: 3 }).run()
    expect(openKeys(db, leitung)).not.toContain('employee_pin')
    db.update(facilities).set({ timeTrackingFrom: '2026-10-01' }).where(eq(facilities.id, 1)).run()
    const list = getSetupChecklist(db, leitung, 1, now).open
    expect(list.find(item => item.key === 'employee_pin')!.names.map(entry => entry.name)).toEqual(['Anna', 'Berta'])
    expect(list.find(item => item.key === 'employee_pin_locked')!.names.map(entry => entry.name)).toEqual(['Dora'])
    expect(list.find(item => item.key === 'employee_access')!.names.map(entry => entry.name)).toEqual(['Berta', 'Dora'])
  })

  it('lists groups without group type or documentation and children with a contract without care type', () => {
    const baeren = addGroup(db, 1, 'Bären')
    addChild(db, 1, { firstName: 'Mia', lastName: 'Muster' })
    addChild(db, 1, { firstName: 'Ole', lastName: 'Alt', leftOn: '2026-07-31' })
    addChild(db, 1, { firstName: 'Wim', lastName: 'Warte', admissionStatus: 'waitlist', entryDate: null })
    const list = getSetupChecklist(db, leitung, 1, now).open
    expect(list.find(item => item.key === 'group_type')!.names).toEqual([{ name: 'Bären', to: `/admin/settings/groups/${baeren}` }])
    expect(list.find(item => item.key === 'group_documentation')!.count).toBe(1)
    expect(list.find(item => item.key === 'child_care_type')!.names.map(entry => entry.name)).toEqual(['Mia Muster'])

    db.update(groups).set({ groupType: 'regel', docMode: 'interval' }).where(eq(groups.id, baeren)).run()
    const careType = db.insert(careTypes).values({ facilityId: 1, name: 'Ganztag', start: 420, end: 960 }).returning().get()
    db.update(children).set({ careTypeId: careType.id }).run()
    expect(openKeys(db, leitung)).not.toContain('group_type')
    expect(openKeys(db, leitung)).not.toContain('group_documentation')
    expect(openKeys(db, leitung)).not.toContain('child_care_type')
  })

  it('hides an item for every manager of the facility until it is shown again', () => {
    const krippe = addFacility(db, 'Krippe')
    const other = addUser(db, 'leitung2', 'admin', null, 1)
    hideSetupItem(db, leitung, 1, 'employee_birthday', now)
    hideSetupItem(db, leitung, 1, 'employee_birthday', now)
    expect(openKeys(db, other)).not.toContain('employee_birthday')
    expect(getSetupChecklist(db, traeger, 1, now).hidden.map(item => item.key)).toEqual(['employee_birthday'])
    expect(openKeys(db, traeger, krippe)).toContain('opening_hours')
    expect(getSetupChecklist(db, traeger, krippe, now).hidden).toEqual([])

    showSetupItem(db, other, 1, 'employee_birthday')
    expect(openKeys(db, leitung)).toContain('employee_birthday')
    expect(errorCode(() => showSetupItem(db, leitung, 1, 'employee_birthday'))).toBe('setup_item_not_hidden')
    expect(errorCode(() => hideSetupItem(db, leitung, 1, 'unknown', now))).toBe('invalid_setup_item')
  })
})
