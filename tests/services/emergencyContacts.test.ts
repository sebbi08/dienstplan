import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { employeeEmergencyContacts, employees } from '../../server/db/schema'
import {
  addEmergencyContact, deleteEmergencyContact, listAllEmergencyContacts, listEmergencyContacts, reorderEmergencyContacts,
  updateEmergencyContact,
} from '../../server/services/emergencyContacts'
import { categoryHasData, deleteCategories, RETENTION_CATEGORIES } from '../../server/services/employeeDeletion'
import { effectivePermissions } from '../../shared/domain/permissions'
import type { EmergencyContactInput } from '../../shared/types/api'
import { addEmployee, addFacility, createTestDb, errorCode } from '../helpers/fixtures'

const TODAY = '2026-10-28'
const contact = (name: string, extra: Partial<EmergencyContactInput> = {}): EmergencyContactInput => ({
  name, relation: '', phone: '0171 1234567', phone2: '', note: '', ...extra,
})
const names = (employeeId: number, facilityId = 1) => listEmergencyContacts(db, facilityId, employeeId).map(row => row.name)

let db: Db
let anna: number
let ben: number
let hort: number
let hortEmployee: number

beforeEach(() => {
  db = createTestDb()
  anna = addEmployee(db, 'Anna Beispiel')
  ben = addEmployee(db, 'Ben Muster')
  hort = addFacility(db, 'Hort')
  hortEmployee = addEmployee(db, 'Hanna Hort', { facilityId: hort })
})

describe('emergency contacts of an employee', () => {
  it('adds at the end, trims, changes and deletes', () => {
    const first = addEmergencyContact(db, 1, anna, contact('  Max Beispiel ', {
      relation: ' Ehemann ', phone: ' 0171 1 ', phone2: ' 089 2 ', note: ' nur abends erreichbar ',
    }))
    const second = addEmergencyContact(db, 1, anna, contact('Erika Beispiel', { relation: 'Mutter' }))
    expect(listEmergencyContacts(db, 1, anna)).toEqual([
      { id: first, name: 'Max Beispiel', relation: 'Ehemann', phone: '0171 1', phone2: '089 2', note: 'nur abends erreichbar' },
      { id: second, name: 'Erika Beispiel', relation: 'Mutter', phone: '0171 1234567', phone2: '', note: '' },
    ])
    updateEmergencyContact(db, 1, second, contact('Erika B.', { phone: '0172 9', note: 'vormittags' }))
    expect(listEmergencyContacts(db, 1, anna)[1]).toEqual({ id: second, name: 'Erika B.', relation: '', phone: '0172 9', phone2: '', note: 'vormittags' })
    deleteEmergencyContact(db, 1, first)
    expect(names(anna)).toEqual(['Erika B.'])
    expect(names(ben)).toEqual([])
  })

  it('needs a name and a phone number', () => {
    expect(errorCode(() => addEmergencyContact(db, 1, anna, contact('  ')))).toBe('emergency_contact_name_required')
    expect(errorCode(() => addEmergencyContact(db, 1, anna, contact('Max', { phone: ' ' })))).toBe('emergency_contact_phone_required')
    const id = addEmergencyContact(db, 1, anna, contact('Max'))
    expect(errorCode(() => updateEmergencyContact(db, 1, id, contact('Max', { phone: '' })))).toBe('emergency_contact_phone_required')
    expect(names(anna)).toEqual(['Max'])
  })

  it('keeps the call order and re-orders only with exactly the employee\'s contacts', () => {
    const [a, b, c] = ['A', 'B', 'C'].map(name => addEmergencyContact(db, 1, anna, contact(name)))
    const other = addEmergencyContact(db, 1, ben, contact('Ben-Kontakt'))
    reorderEmergencyContacts(db, 1, anna, [c!, a!, b!])
    expect(names(anna)).toEqual(['C', 'A', 'B'])
    // A new one comes last.
    addEmergencyContact(db, 1, anna, contact('D'))
    expect(names(anna)).toEqual(['C', 'A', 'B', 'D'])
    const ids = listEmergencyContacts(db, 1, anna).map(row => row.id)
    expect(errorCode(() => reorderEmergencyContacts(db, 1, anna, ids.slice(1)))).toBe('invalid_order')
    expect(errorCode(() => reorderEmergencyContacts(db, 1, anna, [...ids.slice(1), other]))).toBe('invalid_order')
    expect(errorCode(() => reorderEmergencyContacts(db, 1, anna, [ids[0]!, ids[0]!, ids[1]!, ids[2]!]))).toBe('invalid_order')
    expect(names(anna)).toEqual(['C', 'A', 'B', 'D'])
    expect(names(ben)).toEqual(['Ben-Kontakt'])
  })

  it('stays within the facility', () => {
    const hortContact = addEmergencyContact(db, hort, hortEmployee, contact('Hort-Kontakt'))
    expect(errorCode(() => listEmergencyContacts(db, 1, hortEmployee))).toBe('employee_not_found')
    expect(errorCode(() => addEmergencyContact(db, 1, hortEmployee, contact('X')))).toBe('employee_not_found')
    expect(errorCode(() => reorderEmergencyContacts(db, 1, hortEmployee, [hortContact]))).toBe('employee_not_found')
    expect(errorCode(() => updateEmergencyContact(db, 1, hortContact, contact('X')))).toBe('emergency_contact_not_found')
    expect(errorCode(() => deleteEmergencyContact(db, 1, hortContact))).toBe('emergency_contact_not_found')
    expect(errorCode(() => deleteEmergencyContact(db, 1, 9999))).toBe('emergency_contact_not_found')
    expect(names(hortEmployee, hort)).toEqual(['Hort-Kontakt'])
  })
})

describe('the print list of all emergency contacts', () => {
  it('lists the employees who have not left, in the staff list order, each with their contacts in call order', () => {
    const left = addEmployee(db, 'Lars Weg', { leftOn: '2026-10-27' })
    const leavingToday = addEmployee(db, 'Lisa Heute', { leftOn: TODAY })
    addEmergencyContact(db, 1, left, contact('Weg-Kontakt'))
    const [x, y] = ['X', 'Y'].map(name => addEmergencyContact(db, 1, ben, contact(name, { relation: 'Vater' })))
    reorderEmergencyContacts(db, 1, ben, [y!, x!])
    addEmergencyContact(db, hort, hortEmployee, contact('Hort-Kontakt'))
    // The staff list order: sort order, then name.
    db.update(employees).set({ sortOrder: 0 }).where(eq(employees.id, ben)).run()

    expect(listAllEmergencyContacts(db, 1, TODAY).map(row => [row.name, row.contacts.map(item => item.name)])).toEqual([
      ['Ben Muster', ['Y', 'X']],
      ['Anna Beispiel', []],
      ['Lisa Heute', []],
    ])
    expect(listAllEmergencyContacts(db, 1, TODAY)[0]).toMatchObject({ employeeId: ben, contacts: [{ id: y, relation: 'Vater' }, { id: x }] })
    expect(listAllEmergencyContacts(db, 1, TODAY)[2]!.employeeId).toBe(leavingToday)
    expect(listAllEmergencyContacts(db, hort, TODAY).map(row => row.contacts.map(item => item.name))).toEqual([['Hort-Kontakt']])
  })
})

describe('retention and deletion', () => {
  it('belongs to the immediate category: categoryHasData sees it, deleteImmediateData removes only that employee\'s', () => {
    db.update(employees).set({ leftOn: '2026-03-15' }).where(eq(employees.id, anna)).run()
    expect(categoryHasData(db, anna).immediate).toBe(false)
    addEmergencyContact(db, 1, anna, contact('Max'))
    addEmergencyContact(db, 1, ben, contact('Eva'))
    expect(categoryHasData(db, anna)).toEqual({ immediate: true, time: true, assessment: false, paidOvertime: false })
    const counts = db.transaction(tx => deleteCategories(tx, anna, ['immediate']))
    expect(counts.immediate).toBeGreaterThanOrEqual(1)
    expect(names(anna)).toEqual([])
    expect(names(ben)).toEqual(['Eva'])
    expect(categoryHasData(db, anna).immediate).toBe(false)
    expect(db.transaction(tx => deleteCategories(tx, anna, ['immediate'])).immediate).toBe(0)
    expect(RETENTION_CATEGORIES).toContain('immediate')
  })

  it('goes with its employee (ON DELETE CASCADE)', () => {
    addEmergencyContact(db, 1, anna, contact('Max'))
    addEmergencyContact(db, 1, ben, contact('Eva'))
    db.delete(employees).where(eq(employees.id, anna)).run()
    expect(db.select({ name: employeeEmergencyContacts.name }).from(employeeEmergencyContacts).all()).toEqual([{ name: 'Eva' }])
    expect(db.all(sql`PRAGMA foreign_key_check`)).toEqual([])
  })
})

describe('who gets the emergency contacts', () => {
  const ROUTES = [
    'emergency-contacts.get.ts', 'employees/[id]/emergency-contacts.get.ts', 'employees/[id]/emergency-contacts.post.ts',
    'employees/[id]/emergency-contacts/order.post.ts', 'employee-emergency-contacts/[id].put.ts',
    'employee-emergency-contacts/[id].delete.ts',
  ]
  const fixture = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'route-access-before.json'), 'utf8')) as
    Record<string, string[]>

  it('only Träger and Leitung, never a Mitarbeiter or the tablet', () => {
    for (const route of ROUTES) expect(fixture[route], route).toEqual(['provider', 'admin'])
    const observer = effectivePermissions({ role: 'observer', canEditChildren: true, isLeavePlanner: false, contractVisibleToAdmins: false })
    expect(observer.has('employees.view')).toBe(false)
    expect(observer.has('employees.edit')).toBe(false)
    expect(effectivePermissions({ role: 'terminal', canEditChildren: false, isLeavePlanner: false, contractVisibleToAdmins: false }).size).toBe(0)
  })

  it('is in no my/* or tablet route', () => {
    for (const route of Object.keys(fixture).filter(route => route.startsWith('my/') || route.startsWith('terminal/'))) {
      const source = readFileSync(join(process.cwd(), 'server', 'api', ...route.split('/')), 'utf8')
      expect(source, route).not.toMatch(/emergencyContact|EmergencyContact/)
    }
  })
})
