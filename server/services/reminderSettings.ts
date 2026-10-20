import { asc, eq } from 'drizzle-orm'
import { isValidIsoDate } from '../../shared/domain/dates'
import type { DocMode, DocSettings } from '../../shared/domain/reminders'
import { nowInBerlin } from '../../shared/domain/timeRecords'
import type { IsoDate } from '../../shared/domain/types'
import type { DocSettingsInput, ReminderSettingsDto, ReminderSettingsInput } from '../../shared/types/api'
import type { Db } from '../db/client'
import { facilities, groups } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { assertGroup } from './groups'

const DOC_MODES: readonly DocMode[] = ['off', 'interval', 'birthday']

/** A whole number from min to max, else 400 reminder_setting_invalid. */
function checkRange(value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) throw new ServiceError(400, 'reminder_setting_invalid')
}

/**
 * Mode off, interval or birthday; interval 1–24 months; lead 0–12 weeks; a sent start a valid day (all checked whatever
 * the mode).
 */
function checkDoc(doc: DocSettingsInput): void {
  if (!DOC_MODES.includes(doc.mode)) throw new ServiceError(400, 'reminder_setting_invalid')
  checkRange(doc.intervalMonths, 1, 24)
  checkRange(doc.leadWeeks, 0, 12)
  if (doc.docSince !== undefined && !isValidIsoDate(doc.docSince)) throw new ServiceError(400, 'reminder_setting_invalid')
}

/**
 * The columns to store for `doc`. „gilt seit“ (`docSince`) is the sent start („Beginn“) in interval mode, past or
 * future. Otherwise it becomes today when the mode changes (switched on, or interval ↔ birthday), stays when only the
 * months or the lead weeks change, and is cleared when switched off.
 */
function docColumns(doc: DocSettingsInput, stored: { docMode: DocMode; docSince: IsoDate | null }, today: IsoDate) {
  const automatic = doc.mode === 'off' ? null : doc.mode === stored.docMode ? stored.docSince : today
  const docSince = doc.mode === 'interval' && doc.docSince !== undefined ? doc.docSince : automatic
  return { docMode: doc.mode, docIntervalMonths: doc.intervalMonths, docLeadWeeks: doc.leadWeeks, docSince }
}

function docOf(row: { docMode: DocMode; docIntervalMonths: number; docLeadWeeks: number }): DocSettings {
  return { mode: row.docMode, intervalMonths: row.docIntervalMonths, leadWeeks: row.docLeadWeeks }
}

/** The facility's reminder settings with every group's documentation setting in the groups' order (404 facility_not_found). */
export function getReminderSettings(db: Db, facilityId: number): ReminderSettingsDto {
  const row = db.select({
    docMode: facilities.docMode, docIntervalMonths: facilities.docIntervalMonths, docLeadWeeks: facilities.docLeadWeeks,
    docSince: facilities.docSince, birthdayLeadDays: facilities.birthdayLeadDays,
    staffBirthdayLeadDays: facilities.staffBirthdayLeadDays, leavingLeadWeeks: facilities.leavingLeadWeeks,
  }).from(facilities).where(eq(facilities.id, facilityId)).get()
  if (!row) throw new ServiceError(404, 'facility_not_found')
  const groupRows = db.select({
    id: groups.id, name: groups.name, docMode: groups.docMode, docIntervalMonths: groups.docIntervalMonths,
    docLeadWeeks: groups.docLeadWeeks, docSince: groups.docSince,
  }).from(groups).where(eq(groups.facilityId, facilityId)).orderBy(asc(groups.sortOrder), asc(groups.id)).all()
  return {
    noGroupDoc: docOf(row), noGroupDocSince: row.docSince,
    birthdayLeadDays: row.birthdayLeadDays, staffBirthdayLeadDays: row.staffBirthdayLeadDays, leavingLeadWeeks: row.leavingLeadWeeks,
    groups: groupRows.map(group => ({ groupId: group.id, name: group.name, doc: docOf(group), docSince: group.docSince })),
  }
}

/**
 * Stores the facility's settings: the documentation of children without group (its „gilt seit“ or sent start as
 * `docColumns`, today in Berlin), the lead days before child and staff birthdays (0–30) and the lead weeks before a child leaves (0–12); any
 * value out of range → 400 reminder_setting_invalid and nothing changes (404 facility_not_found).
 */
export function setReminderSettings(db: Db, facilityId: number, input: ReminderSettingsInput, now: Date = new Date()): void {
  checkDoc(input.noGroupDoc)
  checkRange(input.birthdayLeadDays, 0, 30)
  checkRange(input.staffBirthdayLeadDays, 0, 30)
  checkRange(input.leavingLeadWeeks, 0, 12)
  const stored = getReminderSettings(db, facilityId)
  const storedDoc = { docMode: stored.noGroupDoc.mode, docSince: stored.noGroupDocSince }
  db.update(facilities).set({
    ...docColumns(input.noGroupDoc, storedDoc, nowInBerlin(now).date),
    birthdayLeadDays: input.birthdayLeadDays, staffBirthdayLeadDays: input.staffBirthdayLeadDays, leavingLeadWeeks: input.leavingLeadWeeks,
  }).where(eq(facilities.id, facilityId)).run()
}

/**
 * Stores the documentation setting of a group of the facility (400 reminder_setting_invalid; 404 group_not_found for a
 * group of another facility; „gilt seit“ or the sent start as `docColumns`, today in Berlin). It applies at once to
 * every child in the group today.
 */
export function setGroupDocSettings(db: Db, facilityId: number, groupId: number, doc: DocSettingsInput, now: Date = new Date()): void {
  assertGroup(db, facilityId, groupId)
  checkDoc(doc)
  const stored = db.select({ docMode: groups.docMode, docSince: groups.docSince }).from(groups).where(eq(groups.id, groupId)).get()!
  db.update(groups).set(docColumns(doc, stored, nowInBerlin(now).date)).where(eq(groups.id, groupId)).run()
}
