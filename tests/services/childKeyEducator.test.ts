import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { children, employees } from '../../server/db/schema'
import {
  createChild, getChild, listChildStaff, listChildren, moveChildToFacility, updateChildMaster,
} from '../../server/services/children'
import { moveEmployeeToFacility } from '../../server/services/employees'
import type { FacilityUser } from '../../server/utils/auth'
import type { ChildMasterInput } from '../../shared/types/api'
import { addChild, addEmployee, addFacility, addUser, createTestDb, errorCode } from '../helpers/fixtures'

const TODAY = '2026-10-09'
const NOW = new Date('2026-10-09T08:30:00.000Z')

const master = (overrides: Partial<ChildMasterInput> = {}): ChildMasterInput => ({
  lastName: 'Meier', firstName: 'Lena', birthDate: '2022-03-15', address: '', groupId: null, careTypeId: null,
  entryDate: '2025-09-01', plannedEntryDate: null, infoMeetingDate: null, schoolStartDate: null, primarySchool: '',
  schoolDistrict: '', keyEducatorId: null, note: '', ...overrides,
})

describe('Bezugserzieher and Schulbezirk of a child', () => {
  let db: Db
  let admin: FacilityUser
  let anna: number
  beforeEach(() => {
    db = createTestDb()
    admin = addUser(db, 'leitung', 'admin') as FacilityUser
    anna = addEmployee(db, 'Anna Beck')
  })

  const record = (id: number, today = TODAY) => getChild(db, admin, id, today)
  const listed = (id: number, today = TODAY) => listChildren(db, 1, 'active', today).find(item => item.id === id)!

  describe('storing', () => {
    it('stores a key educator of the facility on create and update and returns id and name in record and list', () => {
      const id = createChild(db, admin, 1, master({ keyEducatorId: anna }), NOW)
      expect(record(id).master.keyEducatorId).toBe(anna)
      expect(record(id).keyEducatorName).toBe('Anna Beck')
      expect(listed(id)).toMatchObject({ keyEducatorId: anna, keyEducatorName: 'Anna Beck' })

      const ben = addEmployee(db, 'Ben Roth')
      updateChildMaster(db, admin, 1, id, master({ keyEducatorId: ben }), TODAY, NOW)
      expect(record(id).keyEducatorName).toBe('Ben Roth')
      expect(listed(id)).toMatchObject({ keyEducatorId: ben, keyEducatorName: 'Ben Roth' })

      updateChildMaster(db, admin, 1, id, master({ keyEducatorId: null }), TODAY, NOW)
      expect(record(id).master.keyEducatorId).toBeNull()
      expect(record(id).keyEducatorName).toBeNull()
      expect(listed(id)).toMatchObject({ keyEducatorId: null, keyEducatorName: null })
    })

    it('rejects an employee of another facility with key_educator_not_found', () => {
      const other = addFacility(db, 'Krippe')
      const foreign = addEmployee(db, 'Fremd', { facilityId: other })
      expect(errorCode(() => createChild(db, admin, 1, master({ keyEducatorId: foreign }), NOW))).toBe('key_educator_not_found')
      const id = createChild(db, admin, 1, master(), NOW)
      expect(errorCode(() => updateChildMaster(db, admin, 1, id, master({ keyEducatorId: foreign }), TODAY, NOW)))
        .toBe('key_educator_not_found')
      expect(errorCode(() => updateChildMaster(db, admin, 1, id, master({ keyEducatorId: 9999 }), TODAY, NOW)))
        .toBe('key_educator_not_found')
    })

    it('rejects an employee who has already left, but accepts one leaving today or later', () => {
      const gone = addEmployee(db, 'Weg', { leftOn: '2026-10-08' })
      const today = addEmployee(db, 'Heute', { leftOn: TODAY })
      const later = addEmployee(db, 'Spaeter', { leftOn: '2026-12-31' })
      expect(errorCode(() => createChild(db, admin, 1, master({ keyEducatorId: gone }), NOW))).toBe('key_educator_not_found')
      expect(errorCode(() => createChild(db, admin, 1, master({ keyEducatorId: today }), NOW))).toBeNull()
      expect(errorCode(() => createChild(db, admin, 1, master({ keyEducatorId: later }), NOW))).toBeNull()
    })

    it('stores the Schulbezirk trimmed', () => {
      const id = createChild(db, admin, 1, master({ schoolDistrict: '  Grundschule Nord ' }), NOW)
      expect(record(id).master.schoolDistrict).toBe('Grundschule Nord')
      updateChildMaster(db, admin, 1, id, master({ schoolDistrict: ' Süd  ' }), TODAY, NOW)
      expect(record(id).master.schoolDistrict).toBe('Süd')
    })
  })

  describe('effective value', () => {
    it('shows nobody once the employee has left (leftOn yesterday), still shows one leaving in the future', () => {
      const id = addChild(db, 1, { keyEducatorId: anna })
      db.update(employees).set({ leftOn: '2026-10-08' }).where(eq(employees.id, anna)).run()
      expect(listed(id)).toMatchObject({ keyEducatorId: null, keyEducatorName: null })
      expect(record(id).master.keyEducatorId).toBeNull()
      expect(record(id).keyEducatorName).toBeNull()

      db.update(employees).set({ leftOn: '2026-10-10' }).where(eq(employees.id, anna)).run()
      expect(listed(id)).toMatchObject({ keyEducatorId: anna, keyEducatorName: 'Anna Beck' })
      expect(record(id).keyEducatorName).toBe('Anna Beck')

      db.update(employees).set({ leftOn: TODAY }).where(eq(employees.id, anna)).run()
      expect(listed(id).keyEducatorId).toBe(anna)
    })

    it('shows nobody when the stored employee belongs to another facility (stale data)', () => {
      const other = addFacility(db, 'Krippe')
      const id = addChild(db, 1, { keyEducatorId: anna })
      db.update(employees).set({ facilityId: other }).where(eq(employees.id, anna)).run()
      expect(listed(id).keyEducatorId).toBeNull()
      expect(record(id).keyEducatorName).toBeNull()
    })
  })

  describe('clearing', () => {
    it('is cleared when the child moves to another facility', () => {
      const krippe = addFacility(db, 'Krippe')
      const id = addChild(db, 1, { keyEducatorId: anna })
      moveChildToFacility(db, id, krippe)
      expect(db.select().from(children).where(eq(children.id, id)).get()!.keyEducatorId).toBeNull()
    })

    it('is cleared for the children of an employee who moves to another facility, others keep theirs', () => {
      const krippe = addFacility(db, 'Krippe')
      const ben = addEmployee(db, 'Ben Roth')
      const mine = addChild(db, 1, { keyEducatorId: anna })
      const also = addChild(db, 1, { keyEducatorId: anna, lastName: 'Zweit' })
      const theirs = addChild(db, 1, { keyEducatorId: ben })
      const provider = addUser(db, 'traeger', 'provider')
      moveEmployeeToFacility(db, provider, anna, krippe, NOW)
      const keyOf = (id: number) => db.select().from(children).where(eq(children.id, id)).get()!.keyEducatorId
      expect(keyOf(mine)).toBeNull()
      expect(keyOf(also)).toBeNull()
      expect(keyOf(theirs)).toBe(ben)
    })

    it('is set to null when the employee row is deleted (foreign key)', () => {
      const id = addChild(db, 1, { keyEducatorId: anna })
      db.delete(employees).where(eq(employees.id, anna)).run()
      expect(db.select().from(children).where(eq(children.id, id)).get()!.keyEducatorId).toBeNull()
    })
  })

  describe('listChildStaff', () => {
    it('lists the facility\'s employees who have not left, by sort order then name, with id and name only', () => {
      const other = addFacility(db, 'Krippe')
      const ben = addEmployee(db, 'Ben Roth')
      addEmployee(db, 'Fremd', { facilityId: other })
      addEmployee(db, 'Weg', { leftOn: '2026-10-08' })
      const leaving = addEmployee(db, 'Geht bald', { leftOn: '2026-12-31' })
      const staff = listChildStaff(db, 1, TODAY)
      expect(staff).toEqual([
        { id: anna, name: 'Anna Beck' }, { id: ben, name: 'Ben Roth' }, { id: leaving, name: 'Geht bald' },
      ])
    })
  })
})
