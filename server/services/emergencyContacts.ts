import { and, asc, eq, inArray, max } from 'drizzle-orm'
import type { IsoDate } from '../../shared/domain/types'
import type { EmergencyContactDto, EmergencyContactInput, EmergencyContactListRowDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { employeeEmergencyContacts, employees } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { assertEmployee } from './employees'
import { loadEmployees } from './queries'

/**
 * Emergency contacts (Notfallkontakte) of the facility's employees, for Leitung and Träger only (the routes ask for
 * employees.view to read, employees.edit to write); nothing of it reaches the my/* pages or the tablet. The order is
 * the call order: the first contact is called first.
 */

type ContactRow = typeof employeeEmergencyContacts.$inferSelect

function toDto(row: ContactRow): EmergencyContactDto {
  return { id: row.id, name: row.name, relation: row.relation, phone: row.phone, phone2: row.phone2, note: row.note }
}

const inOrder = [asc(employeeEmergencyContacts.sortOrder), asc(employeeEmergencyContacts.id)]

/** The employee's contacts in call order; the employee must belong to the facility (404 employee_not_found). */
export function listEmergencyContacts(db: Db, facilityId: number, employeeId: number): EmergencyContactDto[] {
  assertEmployee(db, facilityId, employeeId)
  return db.select().from(employeeEmergencyContacts).where(eq(employeeEmergencyContacts.employeeId, employeeId))
    .orderBy(...inOrder).all().map(toDto)
}

/** Trimmed values; name (400 emergency_contact_name_required) and phone (400 emergency_contact_phone_required) are required. */
function checkedContact(input: EmergencyContactInput): EmergencyContactInput {
  const checked = {
    name: input.name.trim(), relation: input.relation.trim(), phone: input.phone.trim(), phone2: input.phone2.trim(),
    note: input.note.trim(),
  }
  if (checked.name === '') throw new ServiceError(400, 'emergency_contact_name_required')
  if (checked.phone === '') throw new ServiceError(400, 'emergency_contact_phone_required')
  return checked
}

/** The contact, which must belong to an employee of the facility (otherwise 404 emergency_contact_not_found). */
function loadContact(db: Db, facilityId: number, contactId: number): ContactRow {
  const row = db.select({ contact: employeeEmergencyContacts }).from(employeeEmergencyContacts)
    .innerJoin(employees, eq(employees.id, employeeEmergencyContacts.employeeId))
    .where(and(eq(employeeEmergencyContacts.id, contactId), eq(employees.facilityId, facilityId))).get()
  if (!row) throw new ServiceError(404, 'emergency_contact_not_found')
  return row.contact
}

/** A new contact at the end of the employee's list; returns its id. */
export function addEmergencyContact(db: Db, facilityId: number, employeeId: number, input: EmergencyContactInput): number {
  assertEmployee(db, facilityId, employeeId)
  const checked = checkedContact(input)
  return db.transaction((tx) => {
    const sortOrder = (tx.select({ value: max(employeeEmergencyContacts.sortOrder) }).from(employeeEmergencyContacts)
      .where(eq(employeeEmergencyContacts.employeeId, employeeId)).get()?.value ?? -1) + 1
    return tx.insert(employeeEmergencyContacts).values({ ...checked, employeeId, sortOrder })
      .returning({ id: employeeEmergencyContacts.id }).get().id
  })
}

export function updateEmergencyContact(db: Db, facilityId: number, contactId: number, input: EmergencyContactInput): void {
  loadContact(db, facilityId, contactId)
  db.update(employeeEmergencyContacts).set(checkedContact(input)).where(eq(employeeEmergencyContacts.id, contactId)).run()
}

export function deleteEmergencyContact(db: Db, facilityId: number, contactId: number): void {
  loadContact(db, facilityId, contactId)
  db.delete(employeeEmergencyContacts).where(eq(employeeEmergencyContacts.id, contactId)).run()
}

/** Puts the employee's contacts in the given order; the ids must be exactly the employee's contacts (400 invalid_order). */
export function reorderEmergencyContacts(db: Db, facilityId: number, employeeId: number, ids: number[]): void {
  const existing = new Set(listEmergencyContacts(db, facilityId, employeeId).map(contact => contact.id))
  if (ids.length !== existing.size || new Set(ids).size !== ids.length || !ids.every(id => existing.has(id))) {
    throw new ServiceError(400, 'invalid_order')
  }
  db.transaction((tx) => {
    ids.forEach((id, index) => tx.update(employeeEmergencyContacts).set({ sortOrder: index })
      .where(eq(employeeEmergencyContacts.id, id)).run())
  })
}

/**
 * The print list „Notfallkontakte aller Mitarbeiter“: the facility's employees who have not left (leftOn before today
 * counts as left, as on the staff page), in the order of the staff list, each with their contacts in call order (an
 * employee without contacts stays in the list, so the gap shows).
 */
export function listAllEmergencyContacts(db: Db, facilityId: number, today: IsoDate): EmergencyContactListRowDto[] {
  const staff = loadEmployees(db, facilityId).filter(employee => employee.leftOn === null || employee.leftOn >= today)
  if (staff.length === 0) return []
  const byEmployee = new Map<number, EmergencyContactDto[]>()
  for (const row of db.select().from(employeeEmergencyContacts)
    .where(inArray(employeeEmergencyContacts.employeeId, staff.map(employee => employee.id))).orderBy(...inOrder).all()) {
    byEmployee.set(row.employeeId, [...byEmployee.get(row.employeeId) ?? [], toDto(row)])
  }
  return staff.map(employee => ({ employeeId: employee.id, name: employee.name, contacts: byEmployee.get(employee.id) ?? [] }))
}
