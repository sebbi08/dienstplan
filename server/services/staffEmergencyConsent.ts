import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { isValidIsoDate, todayIso } from '../../shared/domain/dates'
import type { IsoDate } from '../../shared/domain/types'
import type { EmergencyConsentDto, EmergencyConsentInput, SessionUser, TabletStaffEmergencyDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { employeeEmergencyConsent, employeeEmergencyConsentLog, employeeEmergencyContacts, employees, users } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { assertEmployee } from './employees'
import { loadEmployees } from './queries'
import { tabletChildViewer } from './tabletUnlock'

/**
 * Whether colleagues may see an employee's emergency contacts at the facility tablet. Without a row there is no
 * consent. The employee gives and withdraws it in „Meins“ (source 'self'); the Leitung and Träger record a written
 * declaration for those who give it on paper or have no account (source 'written'). A withdrawal by the employee always
 * wins: afterwards only a written declaration with a later day counts again (a declaration cannot be dated later than
 * today, so on the day of the withdrawal it stays off), and a consent the employee gave in the app is withdrawn only by
 * them. Every grant and withdrawal goes into a log that is never changed.
 */

type Source = 'self' | 'written'
type ConsentRow = typeof employeeEmergencyConsent.$inferSelect

function consentRow(db: Db, employeeId: number): ConsentRow | undefined {
  return db.select().from(employeeEmergencyConsent).where(eq(employeeEmergencyConsent.employeeId, employeeId)).get()
}

/** The day of the employee's latest withdrawal in the app, if they ever made one. */
function lastSelfWithdrawal(db: Db, employeeId: number): IsoDate | null {
  return db.select({ date: employeeEmergencyConsentLog.date }).from(employeeEmergencyConsentLog)
    .where(and(
      eq(employeeEmergencyConsentLog.employeeId, employeeId), eq(employeeEmergencyConsentLog.source, 'self'),
      eq(employeeEmergencyConsentLog.granted, false),
    ))
    .orderBy(desc(employeeEmergencyConsentLog.id)).get()?.date ?? null
}

function toDto(db: Db, employeeId: number): EmergencyConsentDto {
  const row = consentRow(db, employeeId)
  const granted = row?.consent === true
  const hasAccount = db.select({ id: users.id }).from(users).where(eq(users.employeeId, employeeId)).get() !== undefined
  // Only while the consent is off: a written declaration then needs a day after the employee's withdrawal.
  const withdrawn = granted ? null : lastSelfWithdrawal(db, employeeId)
  return {
    consent: granted,
    source: row?.source ?? null,
    date: row?.consentDate ?? null,
    hasAccount,
    selfOnly: granted && row?.source === 'self',
    earliestWrittenDate: withdrawn,
  }
}

function record(db: Db, employeeId: number, state: { consent: boolean; source: Source; by: string; at: Date; date: IsoDate }): void {
  const at = state.at.toISOString()
  db.transaction((tx) => {
    const values = { consent: state.consent, consentAt: at, consentDate: state.date, consentBy: state.by, source: state.source }
    tx.insert(employeeEmergencyConsent).values({ employeeId, ...values })
      .onConflictDoUpdate({ target: employeeEmergencyConsent.employeeId, set: values }).run()
    tx.insert(employeeEmergencyConsentLog).values({
      employeeId, granted: state.consent, source: state.source, by: state.by, at, date: state.date,
    }).run()
  })
}

function ownEmployeeId(db: Db, user: SessionUser): number {
  const row = user.employeeId === null ? undefined
    : db.select({ id: employees.id }).from(employees).where(eq(employees.id, user.employeeId)).get()
  if (!row) throw new ServiceError(403, 'no_employee')
  return row.id
}

/** The employee's own consent (403 no_employee for an account without a linked employee). */
export function getMyEmergencyConsent(db: Db, user: SessionUser): EmergencyConsentDto {
  return toDto(db, ownEmployeeId(db, user))
}

/** The employee gives or withdraws their consent in the app; nothing changes (and nothing is logged) if it already is so. */
export function setMyEmergencyConsent(db: Db, user: SessionUser, consent: boolean, now: Date = new Date()): EmergencyConsentDto {
  const employeeId = ownEmployeeId(db, user)
  const row = consentRow(db, employeeId)
  const current = row?.consent === true
  // A consent of Leitung's written record is switched on again by the employee: from then on it is theirs.
  if (current !== consent || (consent && row?.source !== 'self')) {
    record(db, employeeId, { consent, source: 'self', by: 'self', at: now, date: todayIso(now) })
  }
  return toDto(db, employeeId)
}

/** Leitung's and Träger's view of an employee of the facility (404 employee_not_found otherwise). */
export function getEmployeeEmergencyConsent(db: Db, facilityId: number, employeeId: number): EmergencyConsentDto {
  assertEmployee(db, facilityId, employeeId)
  return toDto(db, employeeId)
}

/**
 * Leitung or Träger record a written consent (with the day of the declaration: 400 emergency_consent_date_invalid
 * without a valid day or in the future) or its written withdrawal. A consent the employee gave in the app is theirs to
 * withdraw (409 emergency_consent_self_only); after their withdrawal only a declaration of a later day counts (409
 * emergency_consent_withdrawn_by_self).
 */
export function setEmployeeEmergencyConsent(
  db: Db, actor: SessionUser, facilityId: number, employeeId: number, input: EmergencyConsentInput, now: Date = new Date(),
): EmergencyConsentDto {
  assertEmployee(db, facilityId, employeeId)
  const today = todayIso(now)
  const row = consentRow(db, employeeId)
  if (row?.consent === true && row.source === 'self') throw new ServiceError(409, 'emergency_consent_self_only')
  if (!input.consent) {
    if (row?.consent === true) record(db, employeeId, { consent: false, source: 'written', by: actor.username, at: now, date: today })
    return toDto(db, employeeId)
  }
  const date = input.date
  if (date === undefined || !isValidIsoDate(date) || date > today) throw new ServiceError(400, 'emergency_consent_date_invalid')
  const withdrawn = lastSelfWithdrawal(db, employeeId)
  if (withdrawn !== null && date <= withdrawn) {
    throw new ServiceError(409, 'emergency_consent_withdrawn_by_self')
  }
  if (row?.consent === true && row.source === 'written' && row.consentDate === date) return toDto(db, employeeId)
  record(db, employeeId, { consent: true, source: 'written', by: actor.username, at: now, date })
  return toDto(db, employeeId)
}

/**
 * The tablet's list „Notfallkontakte Team“: the employees of the tablet's facility who have not left and consented,
 * each with their contacts in call order (name, relation, phone numbers; no note), in the order of the staff list; an
 * employee without contacts is left out. Only for an unlocked tablet (403 tablet_locked, the same rules as the child
 * data; the request counts as use). Read per request, so a withdrawal takes effect at once.
 */
export function listTabletEmergencyContacts(
  db: Db, terminal: { id: number; facilityId: number }, token: string | undefined, now: Date = new Date(),
): TabletStaffEmergencyDto[] {
  tabletChildViewer(db, terminal, token, now, true)
  const today = todayIso(now)
  const consenting = new Set(db.select({ id: employeeEmergencyConsent.employeeId }).from(employeeEmergencyConsent)
    .where(eq(employeeEmergencyConsent.consent, true)).all().map(row => row.id))
  const staff = loadEmployees(db, terminal.facilityId)
    .filter(employee => consenting.has(employee.id) && (employee.leftOn === null || employee.leftOn >= today))
  if (staff.length === 0) return []
  const byEmployee = new Map<number, TabletStaffEmergencyDto['contacts']>()
  for (const row of db.select().from(employeeEmergencyContacts)
    .where(inArray(employeeEmergencyContacts.employeeId, staff.map(employee => employee.id)))
    .orderBy(asc(employeeEmergencyContacts.sortOrder), asc(employeeEmergencyContacts.id)).all()) {
    byEmployee.set(row.employeeId, [
      ...byEmployee.get(row.employeeId) ?? [],
      { name: row.name, relation: row.relation, phone: row.phone, phone2: row.phone2 },
    ])
  }
  return staff.flatMap(employee => byEmployee.has(employee.id)
    ? [{ employeeId: employee.id, name: employee.name, contacts: byEmployee.get(employee.id)! }]
    : [])
}
