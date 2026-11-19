import { and, desc, eq, inArray } from 'drizzle-orm'
import { countLeaveDays } from '../../shared/domain/leave'
import {
  DEFAULT_LEAVE_FORFEIT_TEXT, fillLeaveForfeitText, forfeitDateOf, isValidForfeitDate, isValidForfeitText,
  LEAVE_FORFEIT_NOTICE_MONTH, leaveForfeitNoticeYear, type LeaveForfeitDate,
} from '../../shared/domain/leaveForfeit'
import { toIsoDate } from '../../shared/domain/dates'
import { isEmployedInRange, isWorkday } from '../../shared/domain/targets'
import type { IsoDate } from '../../shared/domain/types'
import type {
  LeaveForfeitListDto, LeaveForfeitNoticeDto, LeaveForfeitRowDto, LeaveForfeitSettingsDto, SessionUser,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { facilities, leaveForfeitReceipts, users } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { yearEntitlement } from './leave'
import { loadEmployee, loadEmployees, loadEntries, type EmployeeRecord } from './queries'

/**
 * The notice on remaining leave (BUrlG §7(3), the employer's duty to inform): from 1 October of a year until the
 * forfeiture date in the year after, every employee with an own account and leave left of that year sees it on „Mein
 * Urlaub“ and on the start page until „Gelesen“ (a receipt is kept, see leaveForfeitReceipts); it shows again only
 * when the days rise above the ones read or the forfeiture date or text changes. Leitung and Träger see who read it on
 * „Urlaubsplanung“. Whoever leaves before the forfeiture date is told as well (only employment today counts).
 */

interface ForfeitSetting extends LeaveForfeitDate { text: string | null }

function forfeitSetting(db: Db, facilityId: number): ForfeitSetting {
  const row = db.select({ day: facilities.leaveForfeitDay, month: facilities.leaveForfeitMonth, text: facilities.leaveForfeitText })
    .from(facilities).where(eq(facilities.id, facilityId)).get()
  if (!row) throw new ServiceError(404, 'facility_not_found')
  return row
}

/** The facility's forfeiture date and notice text (404 facility_not_found). */
export function getLeaveForfeitSettings(db: Db, facilityId: number): LeaveForfeitSettingsDto {
  const { day, month, text } = forfeitSetting(db, facilityId)
  return { day, month, text: text ?? DEFAULT_LEAVE_FORFEIT_TEXT, isDefaultText: text === null }
}

/**
 * Stores the forfeiture date (a day of January to September, never 29 February: 400 invalid_forfeit_date) and the
 * text; an empty text or the default text itself stores „no own text“, so the default applies. An own text has to name
 * the days and the forfeiture date (‹Tage› and ‹Verfall›; 400 invalid_forfeit_text): without them a receipt would prove
 * no concrete notice.
 */
export function setLeaveForfeitSettings(
  db: Db, facilityId: number, input: { day: number; month: number; text: string },
): LeaveForfeitSettingsDto {
  forfeitSetting(db, facilityId)
  if (!isValidForfeitDate(input)) throw new ServiceError(400, 'invalid_forfeit_date')
  const text = input.text.trim()
  if (!isValidForfeitText(text)) throw new ServiceError(400, 'invalid_forfeit_text')
  db.update(facilities).set({
    leaveForfeitDay: input.day, leaveForfeitMonth: input.month,
    leaveForfeitText: text === '' || text === DEFAULT_LEAVE_FORFEIT_TEXT ? null : text,
  }).where(eq(facilities.id, facilityId)).run()
  return getLeaveForfeitSettings(db, facilityId)
}

/**
 * The leave of `year` the employee has left on `on`: until 31 December what is free of the year („frei verfügbar“:
 * entitlement and carry-over minus leave taken and planned in the year); after it the carry-over into the next year
 * minus the leave of the next year up to the forfeiture date (taken or planned: that leave uses the carry-over before
 * it lapses). Never below 0; 0 without an entitlement.
 */
function remainingDays(db: Db, employee: EmployeeRecord, year: number, on: IsoDate, setting: LeaveForfeitDate): number {
  if (yearEntitlement(db, employee, year) === null) return 0
  // The carry-over into the next year is exactly what is free of the year (yearEntitlement, leaveAccount.available).
  const free = yearEntitlement(db, employee, year + 1)!.carriedOverDays
  if (on <= `${year}-12-31`) return Math.max(0, free)
  const dates = loadEntries(db, { employeeId: employee.id, from: `${year + 1}-01-01`, to: forfeitDateOf(year, setting), codeKey: 'vacation' })
    .map(entry => entry.date).filter(date => isWorkday(employee.info, date))
  return Math.max(0, free - countLeaveDays([...new Set(dates)], employee.halfLeaveOnEves))
}

/** The notice of the employee on `today`, whether read or not (null: outside the window or no days left). */
function noticeOf(db: Db, employee: EmployeeRecord, today: IsoDate): LeaveForfeitNoticeDto | null {
  if (!isEmployedInRange(employee.info, today, today)) return null
  const setting = forfeitSetting(db, employee.facilityId)
  const year = leaveForfeitNoticeYear(today, setting)
  if (year === null) return null
  const days = remainingDays(db, employee, year, today, setting)
  if (days <= 0) return null
  const forfeitDate = forfeitDateOf(year, setting)
  return { year, days, forfeitDate, text: fillLeaveForfeitText(setting.text ?? DEFAULT_LEAVE_FORFEIT_TEXT, { days, year, forfeitDate }) }
}

type Receipt = typeof leaveForfeitReceipts.$inferSelect

/** The latest receipt of the employee for the year (undefined: never read). */
function latestReceipt(db: Db, employeeId: number, year: number): Receipt | undefined {
  return db.select().from(leaveForfeitReceipts)
    .where(and(eq(leaveForfeitReceipts.employeeId, employeeId), eq(leaveForfeitReceipts.year, year)))
    .orderBy(desc(leaveForfeitReceipts.id)).get()
}

/**
 * Whether a receipt still covers the notice with `days` as it reads now: no more days than read then, and the same
 * forfeiture date and text (the current text filled with the days read then must be the text read). Fewer days need no
 * new notice; more days, another date or another text do.
 */
function covers(receipt: Receipt | undefined, days: number, year: number, setting: ForfeitSetting): boolean {
  if (!receipt || days > receipt.days) return false
  const forfeitDate = forfeitDateOf(year, setting)
  return receipt.text === fillLeaveForfeitText(setting.text ?? DEFAULT_LEAVE_FORFEIT_TEXT, { days: receipt.days, year, forfeitDate })
}

/**
 * The notice the signed-in employee sees now; null without an employee, outside the window, without days or while a
 * receipt covers it (after more days, another forfeiture date or text it shows again, see covers).
 */
export function getMyLeaveForfeitNotice(db: Db, user: SessionUser, today: IsoDate): LeaveForfeitNoticeDto | null {
  if (user.employeeId === null) return null
  const employee = loadEmployee(db, user.employeeId)
  if (!employee) return null
  const notice = noticeOf(db, employee, today)
  if (!notice) return null
  const setting = forfeitSetting(db, employee.facilityId)
  return covers(latestReceipt(db, employee.id, notice.year), notice.days, notice.year, setting) ? null : notice
}

/**
 * „Gelesen“ by the employee themselves (403 no_employee without one): stores the days and the text of the notice as it
 * is shown now. While the latest receipt of the year covers the notice a click stores nothing and answers that
 * receipt's time; after more days or another date/text it adds a new receipt (the earlier ones stay). 409
 * leave_forfeit_no_notice when there is no notice of that year to read (unless it was read before).
 */
export function markLeaveForfeitRead(db: Db, user: SessionUser, year: number, today: IsoDate, now: Date = new Date()): { readAt: string } {
  if (user.employeeId === null) throw new ServiceError(403, 'no_employee')
  const employee = loadEmployee(db, user.employeeId)
  if (!employee) throw new ServiceError(403, 'no_employee')
  const existing = latestReceipt(db, employee.id, year)
  const notice = noticeOf(db, employee, today)
  if (!notice || notice.year !== year) {
    // Clicked once more after the notice ended or its days ran out: it stays read.
    if (existing) return { readAt: existing.readAt }
    throw new ServiceError(409, 'leave_forfeit_no_notice')
  }
  if (covers(existing, notice.days, year, forfeitSetting(db, employee.facilityId))) return { readAt: existing!.readAt }
  const readAt = now.toISOString()
  db.insert(leaveForfeitReceipts).values({
    employeeId: employee.id, year, days: notice.days, text: notice.text, readAt, readBy: user.id,
  }).run()
  return { readAt }
}

/**
 * „Hinweis auf Resturlaub ‹Jahr›“: the facility's staff employed on the day looked at (today, after the forfeiture date
 * that date) with leave of the year left then, plus anyone who has read the notice of the year, in the staff order.
 * Status: read (the latest receipt covers the notice; with its time and days), reopened (read, but now more days or
 * another date/text, so the box shows again), open (an active account, not read yet) or no_account (no active account:
 * to be told in writing). Before the window of the year (1 October) nobody is listed yet (`started` false).
 */
export function getLeaveForfeitList(db: Db, facilityId: number, year: number, today: IsoDate): LeaveForfeitListDto {
  const setting = forfeitSetting(db, facilityId)
  const forfeitDate = forfeitDateOf(year, setting)
  const noticeFrom = toIsoDate(year, LEAVE_FORFEIT_NOTICE_MONTH, 1)
  if (today < noticeFrom) return { year, noticeFrom, forfeitDate, started: false, rows: [] }
  const on = today > forfeitDate ? forfeitDate : today
  const staff = loadEmployees(db, facilityId).filter(employee => isEmployedInRange(employee.info, on, on))
  const ids = staff.map(employee => employee.id)
  const receipts = new Map((ids.length === 0 ? [] : db.select().from(leaveForfeitReceipts)
    .where(and(eq(leaveForfeitReceipts.year, year), inArray(leaveForfeitReceipts.employeeId, ids)))
    .orderBy(leaveForfeitReceipts.id).all())
    // In id order, so each employee's latest receipt wins.
    .map(receipt => [receipt.employeeId, receipt]))
  const withAccount = new Set(ids.length === 0 ? [] : db.select({ employeeId: users.employeeId }).from(users)
    .where(and(eq(users.active, true), inArray(users.employeeId, ids))).all().map(row => row.employeeId))
  const rows: LeaveForfeitRowDto[] = []
  for (const employee of staff) {
    const days = remainingDays(db, employee, year, on, setting)
    const receipt = receipts.get(employee.id)
    if (days <= 0 && !receipt) continue
    rows.push({
      employeeId: employee.id, name: employee.name, days,
      status: receipt && (days <= 0 || covers(receipt, days, year, setting))
        ? 'read'
        : !withAccount.has(employee.id) ? 'no_account' : receipt ? 'reopened' : 'open',
      readAt: receipt?.readAt ?? null, readDays: receipt?.days ?? null,
    })
  }
  return { year, noticeFrom, forfeitDate, started: true, rows }
}
