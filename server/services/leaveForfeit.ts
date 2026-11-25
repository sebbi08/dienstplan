import { and, desc, eq, inArray } from 'drizzle-orm'
import { countLeaveDays } from '../../shared/domain/leave'
import {
  DEFAULT_LEAVE_FORFEIT_TEXT, fillLeaveForfeitText, forfeitDateOf, isValidForfeitDate, isValidForfeitText,
  LEAVE_FORFEIT_NOTICE_MONTH, leaveForfeitNoticeYear, type LeaveForfeitDate,
} from '../../shared/domain/leaveForfeit'
import { toIsoDate } from '../../shared/domain/dates'
import { protectedNoticeFrom } from '../../shared/domain/parentalLeave'
import { isEmployedInRange, isLeaveWorkday } from '../../shared/domain/targets'
import type { IsoDate } from '../../shared/domain/types'
import type {
  LeaveForfeitListDto, LeaveForfeitNoticeDto, LeaveForfeitRowDto, LeaveForfeitSettingsDto, SessionUser,
} from '../../shared/types/api'
import type { Db } from '../db/client'
import { facilities, leaveForfeitReceipts, users } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { leaveProtectionOf, yearEntitlement } from './leave'
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
 * it lapses). Never below 0; 0 without an entitlement. `forfeitDate` is the year's effective one (effectiveForfeit).
 */
function remainingDays(db: Db, employee: EmployeeRecord, year: number, on: IsoDate, forfeitDate: IsoDate): number {
  if (yearEntitlement(db, employee, year) === null) return 0
  // The carry-over into the next year is exactly what is free of the year (yearEntitlement, leaveAccount.available).
  const free = yearEntitlement(db, employee, year + 1)!.carriedOverDays
  if (on <= `${year}-12-31`) return Math.max(0, free)
  const dates = loadEntries(db, { employeeId: employee.id, from: `${year + 1}-01-01`, to: forfeitDate, codeKey: 'vacation' })
    .map(entry => entry.date).filter(date => isLeaveWorkday(employee.info, date))
  return Math.max(0, free - countLeaveDays([...new Set(dates)], employee.halfLeaveOnEves))
}

interface EffectiveForfeit { date: IsoDate; from: IsoDate; protected: boolean }

/**
 * The forfeiture date of the year's remaining leave for the employee and the first day of its notice: the facility's
 * (from 1 October of the year), or – while an Elternzeit keeps the leave from lapsing (§ 17 Abs. 2 BEEG, leave.ts
 * leaveProtectionOf) – 31 December of the year after the return, noticed from 1 July of that last year
 * (protectedNoticeFrom). Before that the leave does not lapse and there is no notice.
 */
function effectiveForfeit(db: Db, employee: EmployeeRecord, year: number, setting: LeaveForfeitDate): EffectiveForfeit {
  const protection = leaveProtectionOf(db, employee, year)
  if (protection) return { date: protection.until, from: protectedNoticeFrom(protection), protected: true }
  return { date: forfeitDateOf(year, setting), from: toIsoDate(year, LEAVE_FORFEIT_NOTICE_MONTH, 1), protected: false }
}

/**
 * The year whose notice speaks for `year`: the years one Elternzeit protects share one date, and the carry-over is
 * cumulative, so the latest of them names everything that lapses on that day (its days include the earlier rest). The
 * year itself when it is not protected or no later year shares its date.
 */
function noticeYearFor(db: Db, employee: EmployeeRecord, year: number, setting: LeaveForfeitDate, forfeit: EffectiveForfeit): number {
  if (!forfeit.protected) return year
  let latest = year
  for (let later = year + 1; later <= Number(forfeit.date.slice(0, 4)); later++) {
    const other = effectiveForfeit(db, employee, later, setting)
    if (other.protected && other.date === forfeit.date) latest = later
  }
  return latest
}

/** Years back the notice looks for leave whose (moved) forfeiture date is still ahead: an Elternzeit lasts up to 3 years at a time. */
const NOTICE_YEARS_BACK = 6

/**
 * The days the notice of `year` (forfeiture `date`) names: what is left of the year (remainingDays, cumulative like the
 * carry-over) without the protected rest of earlier years that lapses on an earlier day of its own (§ 17 Abs. 2 BEEG,
 * the notice of the latest of those years): e.g. the usual notice of the year after the return does not count the
 * Elternzeit leave again that lapses on 31 December before it.
 */
function noticeDays(db: Db, employee: EmployeeRecord, year: number, on: IsoDate, date: IsoDate, setting: LeaveForfeitDate): number {
  let days = remainingDays(db, employee, year, on, date)
  if (days <= 0 || !(employee.info.parentalLeaves ?? []).length) return Math.max(0, days)
  for (let earlier = year - NOTICE_YEARS_BACK; earlier < year; earlier++) {
    const forfeit = effectiveForfeit(db, employee, earlier, setting)
    if (!forfeit.protected || forfeit.date >= date || noticeYearFor(db, employee, earlier, setting, forfeit) !== earlier) continue
    days -= remainingDays(db, employee, earlier, on < forfeit.date ? on : forfeit.date, forfeit.date)
  }
  return Math.max(0, days)
}

/**
 * The notices of the employee on `today`, whether read or not, by forfeiture date: per year whose notice window
 * (effectiveForfeit) contains today and that has leave left – the protected years of one Elternzeit (one date) as one
 * notice of the latest of them, with the total that lapses then (noticeYearFor). Several can be open at once, e.g. the
 * protected leave and the usual notice of the year after the return from October to December.
 */
function noticesOf(db: Db, employee: EmployeeRecord, today: IsoDate): LeaveForfeitNoticeDto[] {
  if (!isEmployedInRange(employee.info, today, today)) return []
  const setting = forfeitSetting(db, employee.facilityId)
  const thisYear = Number(today.slice(0, 4))
  const notices = new Map<number, LeaveForfeitNoticeDto>()
  for (let year = thisYear - NOTICE_YEARS_BACK; year <= thisYear; year++) {
    const forfeit = effectiveForfeit(db, employee, year, setting)
    if (today < forfeit.from || today > forfeit.date) continue
    const noticeYear = noticeYearFor(db, employee, year, setting, forfeit)
    if (notices.has(noticeYear)) continue
    const days = noticeDays(db, employee, noticeYear, today, forfeit.date, setting)
    if (days <= 0) continue
    const forfeitDate = forfeit.date
    notices.set(noticeYear, {
      year: noticeYear, days, forfeitDate,
      text: fillLeaveForfeitText(setting.text ?? DEFAULT_LEAVE_FORFEIT_TEXT, { days, year: noticeYear, forfeitDate }),
    })
  }
  return [...notices.values()].sort((a, b) => (a.forfeitDate < b.forfeitDate ? -1 : a.forfeitDate > b.forfeitDate ? 1 : a.year - b.year))
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
function covers(receipt: Receipt | undefined, days: number, year: number, setting: ForfeitSetting, forfeitDate: IsoDate): boolean {
  if (!receipt || days > receipt.days) return false
  return receipt.text === fillLeaveForfeitText(setting.text ?? DEFAULT_LEAVE_FORFEIT_TEXT, { days: receipt.days, year, forfeitDate })
}

/**
 * The notice the signed-in employee sees now: the first open notice (noticesOf) that no receipt covers (after more days,
 * another forfeiture date or text it shows again, see covers); null without an employee or when there is none.
 */
export function getMyLeaveForfeitNotice(db: Db, user: SessionUser, today: IsoDate): LeaveForfeitNoticeDto | null {
  if (user.employeeId === null) return null
  const employee = loadEmployee(db, user.employeeId)
  if (!employee) return null
  const setting = forfeitSetting(db, employee.facilityId)
  return noticesOf(db, employee, today)
    .find(notice => !covers(latestReceipt(db, employee.id, notice.year), notice.days, notice.year, setting, notice.forfeitDate)) ?? null
}

/**
 * „Gelesen“ by the employee themselves (403 no_employee without one) for any open notice of that year (noticesOf):
 * stores the days and the text as shown now. While the latest receipt of the year covers the notice a click stores
 * nothing and answers that receipt's time; after more days or another date/text it adds a new receipt (the earlier ones
 * stay). 409 leave_forfeit_no_notice when there is no open notice of that year (unless it was read before).
 */
export function markLeaveForfeitRead(db: Db, user: SessionUser, year: number, today: IsoDate, now: Date = new Date()): { readAt: string } {
  if (user.employeeId === null) throw new ServiceError(403, 'no_employee')
  const employee = loadEmployee(db, user.employeeId)
  if (!employee) throw new ServiceError(403, 'no_employee')
  const existing = latestReceipt(db, employee.id, year)
  const notice = noticesOf(db, employee, today).find(candidate => candidate.year === year)
  if (!notice) {
    // Clicked once more after the notice ended or its days ran out: it stays read.
    if (existing) return { readAt: existing.readAt }
    throw new ServiceError(409, 'leave_forfeit_no_notice')
  }
  if (covers(existing, notice.days, year, forfeitSetting(db, employee.facilityId), notice.forfeitDate)) return { readAt: existing!.readAt }
  const readAt = now.toISOString()
  db.insert(leaveForfeitReceipts).values({
    employeeId: employee.id, year, days: notice.days, text: notice.text, readAt, readBy: user.id,
  }).run()
  return { readAt }
}

/**
 * The notice state per employee today, for the employee list: the year whose notice runs today (1 October until the
 * forfeiture date) and its rows, only of people with leave left (null outside that window); and, for anybody whose
 * leave an Elternzeit protects, the open notice of that leave (`protectedRows`, keyed by employee, with the notice's
 * year and date) – the first one no receipt covers, else the first one.
 */
export function getLeaveForfeitStatuses(
  db: Db, facilityId: number, today: IsoDate,
): { year: number | null; rows: Map<number, LeaveForfeitRowDto>; protectedRows: Map<number, LeaveForfeitRowDto & { year: number }> } {
  const setting = forfeitSetting(db, facilityId)
  const year = leaveForfeitNoticeYear(today, setting)
  const rows = year === null ? [] : getLeaveForfeitList(db, facilityId, year, today).rows.filter(row => row.days > 0)
  const protectedRows = new Map<number, LeaveForfeitRowDto & { year: number }>()
  const withAccount = new Set(db.select({ employeeId: users.employeeId }).from(users).where(eq(users.active, true)).all()
    .map(row => row.employeeId))
  for (const employee of loadEmployees(db, facilityId)) {
    if (!(employee.info.parentalLeaves ?? []).length) continue
    const statuses = noticesOf(db, employee, today)
      // Only the moved ones: the usual notice is in `rows`.
      .filter(notice => notice.forfeitDate !== forfeitDateOf(notice.year, setting))
      .map((notice) => {
        const receipt = latestReceipt(db, employee.id, notice.year)
        const read = covers(receipt, notice.days, notice.year, setting, notice.forfeitDate)
        const status: LeaveForfeitRowDto['status'] = read ? 'read' : !withAccount.has(employee.id) ? 'no_account' : receipt ? 'reopened' : 'open'
        return {
          employeeId: employee.id, name: employee.name, days: notice.days, protectedUntil: notice.forfeitDate, status,
          readAt: receipt?.readAt ?? null, readDays: receipt?.days ?? null, year: notice.year,
        }
      })
    const shown = statuses.find(row => row.status !== 'read') ?? statuses[0]
    if (shown) protectedRows.set(employee.id, shown)
  }
  return { year, rows: new Map(rows.map(row => [row.employeeId, row])), protectedRows }
}

/**
 * „Hinweis auf Resturlaub ‹Jahr›“: the facility's staff employed on the day looked at (today, after the forfeiture date
 * that date) with leave of the year left then, plus anyone who has read the notice of the year, in the staff order.
 * Status: read (the latest receipt covers the notice; with its time and days), reopened (read, but now more days or
 * another date/text, so the box shows again), open (an active account, not read yet) or no_account (no active account:
 * to be told in writing). Before the window of the year (1 October) nobody is listed yet (`started` false). Leave an
 * Elternzeit protects is listed only from its own notice window on, under the notice of the latest year sharing its date
 * (noticeYearFor: its days, its receipt), with that date in `protectedUntil`.
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
    // An Elternzeit moves the forfeiture date (§ 17 Abs. 2 BEEG): before its notice starts the person is not listed
    // (a receipt from before the Elternzeit names the old date and says nothing now).
    const forfeit = effectiveForfeit(db, employee, year, setting)
    if (forfeit.protected && today < forfeit.from) continue
    const noticeYear = noticeYearFor(db, employee, year, setting, forfeit)
    const receipt = noticeYear === year ? receipts.get(employee.id) : latestReceipt(db, employee.id, noticeYear)
    const days = noticeDays(db, employee, noticeYear, today > forfeit.date ? forfeit.date : today, forfeit.date, setting)
    if (days <= 0 && !receipt) continue
    rows.push({
      employeeId: employee.id, name: employee.name, days, protectedUntil: forfeit.protected ? forfeit.date : null,
      status: receipt && (days <= 0 || covers(receipt, days, noticeYear, setting, forfeit.date))
        ? 'read'
        : !withAccount.has(employee.id) ? 'no_account' : receipt ? 'reopened' : 'open',
      readAt: receipt?.readAt ?? null, readDays: receipt?.days ?? null,
    })
  }
  return { year, noticeFrom, forfeitDate, started: true, rows }
}
