import { and, eq, inArray, isNotNull, lt, ne } from 'drizzle-orm'
import { childPurgeDate, childStatus, purgeDate } from '../../shared/domain/children'
import { can } from '../../shared/domain/permissions'
import { inspectionDeadline, inspectionOverdue } from '../../shared/domain/requiredDocuments'
import { retentionDueDates, type RetentionSettings } from '../../shared/domain/retention'
import type { IsoDate } from '../../shared/domain/types'
import {
  addMonths, applicantDeletableFrom, applicantLastActivity, infoVisitDeletableFrom,
} from '../../shared/domain/visits'
import type { RetentionDeleteResult, RetentionItemCategory, RetentionItemDto, SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { applicantVisitDays, applicantVisits, cashBoxes, children, employeeHours, employees, facilities, infoVisits } from '../db/schema'
import { ServiceError } from '../lib/errors'
import { getChildRetentionYears } from './appSettings'
import { bemDeletableDates, deleteDueBemProcesses, employeesWithBem } from './bem'
import { deleteDueMaternityCases, employeesWithMaternity, maternityDeletableDates } from './maternity'
import { boxDeletableFrom } from './cashBoxes'
import { lastChildAccidents } from './childAccidentRetention'
import { removeArchivedBox } from './cashPurge'
import { deleteChild } from './children'
import {
  categoryHasData, deleteCategories, deleteEmployeeRow, foreignKeyViolations, isForeignKeyError, RETENTION_CATEGORIES,
  type RetentionCategory,
} from './employeeDeletion'
import { getRetentionSettings } from './retentionSettings'
import { finishedSignRequests, removeSignRequest, type SignRequestRetentionRow } from './signRequestRecords'

const ITEM_CATEGORIES: readonly RetentionItemCategory[] = [...RETENTION_CATEGORIES, 'record']
const KIND_ORDER: Record<RetentionItemDto['kind'], number> = { employee: 0, child: 1, cash: 2, signRequest: 3, infoVisit: 4, applicant: 5 }

type PlainKind = 'child' | 'cash' | 'signRequest' | 'infoVisit' | 'applicant'
type ItemKey =
  | { kind: 'employee'; id: number; category: RetentionItemCategory }
  | { kind: PlainKind; id: number }

const KEY_PATTERN = /^(?:employee:([1-9]\d{0,15}):([A-Za-z]+)|(child|cash|signRequest|infoVisit|applicant):([1-9]\d{0,15}))$/

/**
 * `employee:<id>:<category>`, `child:<id>`, `cash:<id>`, `signRequest:<id>`, `infoVisit:<id>` or `applicant:<id>`;
 * anything else is 400 retention_key_invalid.
 */
function parseKey(key: string): ItemKey {
  const match = KEY_PATTERN.exec(key)
  const id = Number(match?.[1] ?? match?.[4])
  if (!match || !Number.isSafeInteger(id)) throw new ServiceError(400, 'retention_key_invalid')
  if (match[3]) return { kind: match[3] as PlainKind, id }
  const category = match[2] as RetentionItemCategory
  if (!ITEM_CATEGORIES.includes(category)) throw new ServiceError(400, 'retention_key_invalid')
  return { kind: 'employee', id, category }
}

/** Facility names, the retention settings per facility and the child retention, each read once per request. */
interface Context {
  today: IsoDate
  facilityName: (id: number) => string
  settings: (facilityId: number) => RetentionSettings
  childYears: () => number
}

function context(db: Db, today: IsoDate): Context {
  const names = new Map(db.select({ id: facilities.id, name: facilities.name }).from(facilities).all().map(row => [row.id, row.name]))
  const settings = new Map<number, RetentionSettings>()
  let childYears: number | null = null
  return {
    today,
    facilityName: id => names.get(id) ?? '',
    settings: (facilityId) => {
      if (!settings.has(facilityId)) settings.set(facilityId, getRetentionSettings(db, facilityId))
      return settings.get(facilityId)!
    },
    childYears: () => childYears ??= getChildRetentionYears(db),
  }
}

type EmployeeRow = { id: number; name: string; facilityId: number; leftOn: IsoDate }

/**
 * While a Lohnbüro keeps the payroll records (the default), „Lohn und Steuer“ is part of the personal data: no item of
 * its own, the personal data's item holds it and deletes it along (categoriesOf). Without one it is an item of its own,
 * due 6 years after the end of the leaving year.
 */
function withPayroll(hasData: Record<RetentionCategory, boolean>, settings: RetentionSettings): Record<RetentionCategory, boolean> {
  if (!settings.payrollOffice) return hasData
  return { ...hasData, immediate: hasData.immediate || hasData.payroll, payroll: false }
}

/** The categories deleting an item removes: the personal data with „Lohn und Steuer“ while a Lohnbüro keeps those. */
function categoriesOf(category: RetentionCategory, settings: RetentionSettings): RetentionCategory[] {
  return category === 'immediate' && settings.payrollOffice ? ['immediate', 'payroll'] : [category]
}

/**
 * The items of an employee with a leaving day: one per category that holds data (categoryHasData), from its due date
 * (retentionDueDates with the facility's periods), and the record, due once no other category holds data. Nothing is
 * due before the day after leaving.
 */
function employeeItems(db: Db, employee: EmployeeRow, ctx: Context): RetentionItemDto[] {
  const hasData = withPayroll(categoryHasData(db, employee.id), ctx.settings(employee.facilityId))
  const dueDates = retentionDueDates(employee.leftOn, ctx.settings(employee.facilityId))
  const left = employee.leftOn < ctx.today
  const item = (category: RetentionItemCategory, deletableFrom: IsoDate | null, due: boolean): RetentionItemDto => ({
    key: `employee:${employee.id}:${category}`, kind: 'employee', category, facilityId: employee.facilityId,
    facilityName: ctx.facilityName(employee.facilityId), name: employee.name, deletableFrom, due,
  })
  return [
    ...RETENTION_CATEGORIES.filter(category => hasData[category]).flatMap((category) => {
      if (category === 'bem') {
        const bem = bemItem(db, employee, ctx)
        return bem ? [bem] : []
      }
      if (category === 'maternity') {
        const maternity = maternityItem(db, employee, ctx)
        return maternity ? [maternity] : []
      }
      if (category === 'inspection') {
        // From the day after leaving, gone by the deadline (§ 72a Abs. 5 SGB VIII); overdue items come first, in red.
        const { deletableFrom, deleteBy } = inspectionDeadline(employee.leftOn, startedOn(db, employee.id))
        const due = left && deletableFrom <= ctx.today
        return [{ ...item(category, deletableFrom, due), inspection: { deleteBy, overdue: due && inspectionOverdue(deleteBy, ctx.today) } }]
      }
      return [item(category, dueDates[category], left && dueDates[category] <= ctx.today)]
    }),
    item('record', null, left && RETENTION_CATEGORIES.every(category => !hasData[category])),
  ]
}

/**
 * The day the activity began, for „not taken up“ (inspectionDeadline): „beschäftigt seit“ of the contract data,
 * else the first weekly hours (as „Einstellen“ of an applicant enters them); null without either.
 */
function startedOn(db: Db, employeeId: number): IsoDate | null {
  const employed = db.select({ since: employees.employedSince }).from(employees).where(eq(employees.id, employeeId)).get()?.since ?? null
  if (employed !== null) return employed
  const first = db.select({ validFrom: employeeHours.validFrom }).from(employeeHours).where(eq(employeeHours.employeeId, employeeId))
    .orderBy(employeeHours.validFrom).limit(1).get()
  return first?.validFrom ?? null
}

/**
 * „BEM-Unterlagen“ of an employee, whether still there or left: each process may be deleted the BEM years after it
 * ended (a running one of someone who left: after the leaving day; bemDeletableFrom). The item shows the earliest such
 * day and is due once one process may go; deleting it removes only the processes due (deleteDueBemProcesses). null
 * while no process has ended.
 */
function bemItem(db: Db, employee: { id: number; name: string; facilityId: number; leftOn: IsoDate | null }, ctx: Context): RetentionItemDto | null {
  const [first] = bemDeletableDates(db, employee.id, employee.leftOn, ctx.today, ctx.settings(employee.facilityId).bemYears)
  if (first === undefined) return null
  return {
    key: `employee:${employee.id}:bem`, kind: 'employee', category: 'bem', facilityId: employee.facilityId,
    facilityName: ctx.facilityName(employee.facilityId), name: employee.name, deletableFrom: first.from,
    bem: { endedOn: first.endedOn, employed: employee.leftOn === null || employee.leftOn >= ctx.today }, due: first.from <= ctx.today,
  }
}

/**
 * „Mutterschutz-Unterlagen“ of an employee, whether still there or left: each case may be deleted the Mutterschutz years
 * (default 2, § 27 Abs. 5 MuSchG) after it ended (maternityLastDay; a running one of someone who left: after the leaving
 * day). Like the BEM item: the earliest such day, due once one case may go; deleting removes only the cases due.
 */
function maternityItem(db: Db, employee: { id: number; name: string; facilityId: number; leftOn: IsoDate | null }, ctx: Context): RetentionItemDto | null {
  const [first] = maternityDeletableDates(db, employee.id, employee.leftOn, ctx.today, ctx.settings(employee.facilityId).maternityYears)
  if (first === undefined) return null
  return {
    key: `employee:${employee.id}:maternity`, kind: 'employee', category: 'maternity', facilityId: employee.facilityId,
    facilityName: ctx.facilityName(employee.facilityId), name: employee.name, deletableFrom: first.from,
    maternity: { endedOn: first.endedOn, employed: employee.leftOn === null || employee.leftOn >= ctx.today }, due: first.from <= ctx.today,
  }
}

/** The Mutterschutz items of employees who have not left (before today): those of the others come with employeeItems. */
function activeMaternityItems(db: Db, ctx: Context): RetentionItemDto[] {
  const ids = employeesWithMaternity(db)
  if (ids.length === 0) return []
  return db.select({ id: employees.id, name: employees.name, facilityId: employees.facilityId, leftOn: employees.leftOn })
    .from(employees).where(inArray(employees.id, ids)).all()
    .filter(employee => employee.leftOn === null || employee.leftOn >= ctx.today)
    .flatMap(employee => maternityItem(db, employee, ctx) ?? [])
}

/** The BEM items of employees who have not left (before today): those of the others come with employeeItems. */
function activeBemItems(db: Db, ctx: Context): RetentionItemDto[] {
  const ids = employeesWithBem(db)
  if (ids.length === 0) return []
  return db.select({ id: employees.id, name: employees.name, facilityId: employees.facilityId, leftOn: employees.leftOn })
    .from(employees).where(inArray(employees.id, ids)).all()
    .filter(employee => employee.leftOn === null || employee.leftOn >= ctx.today)
    .flatMap(employee => bemItem(db, employee, ctx) ?? [])
}

type ChildRow = { id: number; facilityId: number; firstName: string; lastName: string; leftOn: IsoDate }

/**
 * An archived record, deletable from purgeDate with the Träger's child retention, but not before its newest accident
 * report is 5 years old (childPurgeDate, DGUV Vorschrift 1 § 24 Abs. 6): then `accidentHold` says so.
 */
function childItem(child: ChildRow, lastAccident: IsoDate | null, ctx: Context): RetentionItemDto {
  const deletableFrom = childPurgeDate(child.leftOn, ctx.childYears(), lastAccident)
  return {
    key: `child:${child.id}`, kind: 'child', category: null, facilityId: child.facilityId,
    facilityName: ctx.facilityName(child.facilityId), name: `${child.firstName} ${child.lastName}`, deletableFrom,
    ...(deletableFrom > purgeDate(child.leftOn, ctx.childYears()) ? { accidentHold: true } : {}),
    due: child.leftOn < ctx.today && deletableFrom <= ctx.today,
  }
}

type BoxRow = { id: number; facilityId: number; name: string }

/** An archived box, deletable from its deletableFrom as the cash page shows it (null: no entries or history, due). */
function cashItem(db: Db, box: BoxRow, ctx: Context): RetentionItemDto {
  const deletableFrom = boxDeletableFrom(db, box.facilityId, box.id)
  return {
    key: `cash:${box.id}`, kind: 'cash', category: null, facilityId: box.facilityId, facilityName: ctx.facilityName(box.facilityId),
    name: box.name, deletableFrom, due: deletableFrom === null || deletableFrom <= ctx.today,
  }
}

/**
 * A finished request to sign (Zum Unterschreiben senden) with its sent PDF, deletable one year after its last recipient
 * finished; deleting it keeps the records of signatures and declines (removeSignRequest).
 */
function signRequestItem(row: SignRequestRetentionRow, ctx: Context): RetentionItemDto {
  return {
    key: `signRequest:${row.id}`, kind: 'signRequest', category: null, facilityId: row.facilityId, facilityName: ctx.facilityName(row.facilityId),
    name: row.title, deletableFrom: row.deletableFrom, due: row.deletableFrom <= ctx.today,
  }
}

type InfoVisitRow = { id: number; facilityId: number; familyName: string; visitDate: IsoDate; status: string }

/** An info visit not taken over as a Vormerkung (open or declined), deletable the Träger's months after the visit day. */
function infoVisitItem(row: InfoVisitRow, ctx: Context): RetentionItemDto {
  const deletableFrom = infoVisitDeletableFrom(row.visitDate, ctx.settings(row.facilityId).infoVisitMonths)
  return {
    key: `infoVisit:${row.id}`, kind: 'infoVisit', category: null, facilityId: row.facilityId, facilityName: ctx.facilityName(row.facilityId),
    name: row.familyName, deletableFrom, due: deletableFrom <= ctx.today,
  }
}

type ApplicantRow = { id: number; facilityId: number; name: string; status: string; declinedAt: IsoDate | null; updatedAt: string }

/**
 * An applicant not hired: declined, deletable the Träger's months after the refusal; open without any activity
 * (applicantLastActivity: last change or last day) for the Träger's openApplicantMonths, due from then on („ohne Abschluss“; not
 * listed before). null for a hired one (it goes with the personnel file) and an open one with recent activity.
 */
function applicantItem(db: Db, row: ApplicantRow, ctx: Context): RetentionItemDto | null {
  let deletableFrom: IsoDate
  let applicantState: 'declined' | 'open'
  let quietMonths: number | undefined
  if (row.status === 'declined' && row.declinedAt !== null) {
    deletableFrom = applicantDeletableFrom(row.declinedAt, ctx.settings(row.facilityId).applicantMonths)
    applicantState = 'declined'
  }
  else if (row.status === 'open') {
    const days = db.select({ date: applicantVisitDays.date }).from(applicantVisitDays).where(eq(applicantVisitDays.visitId, row.id)).all()
    quietMonths = ctx.settings(row.facilityId).openApplicantMonths
    deletableFrom = addMonths(applicantLastActivity(row.updatedAt, days.map(day => day.date)), quietMonths)
    if (deletableFrom > ctx.today) return null
    applicantState = 'open'
  }
  else {
    return null
  }
  return {
    key: `applicant:${row.id}`, kind: 'applicant', category: null, facilityId: row.facilityId, facilityName: ctx.facilityName(row.facilityId),
    name: row.name, deletableFrom, applicantState, ...(quietMonths === undefined ? {} : { quietMonths }), due: deletableFrom <= ctx.today,
  }
}

const INFO_VISIT_COLUMNS = {
  id: infoVisits.id, facilityId: infoVisits.facilityId, familyName: infoVisits.familyName, visitDate: infoVisits.visitDate, status: infoVisits.status,
}
const APPLICANT_COLUMNS = {
  id: applicantVisits.id, facilityId: applicantVisits.facilityId, name: applicantVisits.name, status: applicantVisits.status,
  declinedAt: applicantVisits.declinedAt, updatedAt: applicantVisits.updatedAt,
}

/**
 * Due first – those past a legal deadline (an inspection record, § 72a Abs. 5 SGB VIII) before the others – by
 * facility, then name; then the later ones by date, the records without a date last.
 */
function compareItems(a: RetentionItemDto, b: RetentionItemDto): number {
  if (a.due !== b.due) return a.due ? -1 : 1
  const overdue = (item: RetentionItemDto) => item.inspection?.overdue === true
  if (overdue(a) !== overdue(b)) return overdue(a) ? -1 : 1
  if (!a.due && a.deletableFrom !== b.deletableFrom) {
    if (a.deletableFrom === null) return 1
    if (b.deletableFrom === null) return -1
    return a.deletableFrom < b.deletableFrom ? -1 : 1
  }
  return a.facilityName.localeCompare(b.facilityName, 'de') || a.facilityId - b.facilityId
    || a.name.localeCompare(b.name, 'de') || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    || ITEM_CATEGORIES.indexOf(a.category ?? 'record') - ITEM_CATEGORIES.indexOf(b.category ?? 'record')
    || a.key.localeCompare(b.key)
}

/**
 * What may be deleted after a retention period, in every facility (spec Löschübersicht §2): employees whose leaving
 * day has passed, an item per category with data and the record (employeeItems); archived child records from
 * purgeDate with the Träger's child retention (later while an accident report is younger than 5 years, childItem);
 * archived cash boxes from their deletableFrom; „BEM-Unterlagen“ also of
 * employees still there (bemItem: from the end of each process), „Mutterschutz-Unterlagen“ the same (maternityItem),
 * finished requests to sign with their sent PDF (signRequestItem). Each item says whether it
 * is due today (deletableFrom <= today). The app deletes nothing by itself; the Träger deletes from this list. The
 * route lets only the Träger read it.
 */
export function retentionOverview(db: Db, today: IsoDate): RetentionItemDto[] {
  const ctx = context(db, today)
  const left = db.select({ id: employees.id, name: employees.name, facilityId: employees.facilityId, leftOn: employees.leftOn })
    .from(employees).where(and(isNotNull(employees.leftOn), lt(employees.leftOn, today))).all() as EmployeeRow[]
  const archivedChildren = db.select({
    id: children.id, facilityId: children.facilityId, firstName: children.firstName, lastName: children.lastName,
    leftOn: children.leftOn, admissionStatus: children.admissionStatus, entryDate: children.entryDate,
  }).from(children).where(isNotNull(children.leftOn)).all().filter(row => childStatus(row, today) === 'archived') as ChildRow[]
  const childAccidents = lastChildAccidents(db, archivedChildren.map(child => child.id))
  const boxes = db.select({ id: cashBoxes.id, facilityId: cashBoxes.facilityId, name: cashBoxes.name }).from(cashBoxes)
    .where(eq(cashBoxes.archived, true)).all()
  return [
    ...left.flatMap(employee => employeeItems(db, employee, ctx)),
    ...activeBemItems(db, ctx),
    ...activeMaternityItems(db, ctx),
    ...archivedChildren.map(child => childItem(child, childAccidents.get(child.id) ?? null, ctx)),
    ...boxes.map(box => cashItem(db, box, ctx)),
    ...finishedSignRequests(db).map(row => signRequestItem(row, ctx)),
    ...db.select(INFO_VISIT_COLUMNS).from(infoVisits).where(ne(infoVisits.status, 'waitlisted')).all().map(row => infoVisitItem(row, ctx)),
    ...db.select(APPLICANT_COLUMNS).from(applicantVisits).where(ne(applicantVisits.status, 'hired')).all()
      .flatMap(row => applicantItem(db, row, ctx) ?? []),
  ].sort(compareItems)
}

/** The item the key names as the overview computes it (also before the leaving day); 404 retention_item_not_found. */
function findItem(db: Db, key: ItemKey, ctx: Context): RetentionItemDto {
  const missing = () => new ServiceError(404, 'retention_item_not_found')
  if (key.kind === 'employee') {
    const employee = db.select({ id: employees.id, name: employees.name, facilityId: employees.facilityId, leftOn: employees.leftOn })
      .from(employees).where(eq(employees.id, key.id)).get()
    if (!employee) throw missing()
    // BEM records count from each process's end, also for someone still employed.
    if (key.category === 'bem') {
      const item = bemItem(db, employee, ctx)
      if (!item) throw missing()
      return item
    }
    // The same for the Mutterschutz records.
    if (key.category === 'maternity') {
      const item = maternityItem(db, employee, ctx)
      if (!item) throw missing()
      return item
    }
    if (employee.leftOn === null) throw missing()
    const item = employeeItems(db, employee as EmployeeRow, ctx).find(candidate => candidate.category === key.category)
    if (!item) throw missing()
    return item
  }
  if (key.kind === 'child') {
    const child = db.select().from(children).where(eq(children.id, key.id)).get()
    if (!child || child.leftOn === null || child.admissionStatus === 'waitlist') throw missing()
    return childItem(child as ChildRow, lastChildAccidents(db, [child.id]).get(child.id) ?? null, ctx)
  }
  if (key.kind === 'signRequest') {
    const row = finishedSignRequests(db).find(candidate => candidate.id === key.id)
    if (!row) throw missing()
    return signRequestItem(row, ctx)
  }
  if (key.kind === 'infoVisit') {
    const row = db.select(INFO_VISIT_COLUMNS).from(infoVisits).where(eq(infoVisits.id, key.id)).get()
    if (!row || row.status === 'waitlisted') throw missing()
    return infoVisitItem(row, ctx)
  }
  if (key.kind === 'applicant') {
    const row = db.select(APPLICANT_COLUMNS).from(applicantVisits).where(eq(applicantVisits.id, key.id)).get()
    const item = row ? applicantItem(db, row, ctx) : null
    if (!item) throw missing()
    return item
  }
  const box = db.select().from(cashBoxes).where(eq(cashBoxes.id, key.id)).get()
  if (!box || !box.archived) throw missing()
  return cashItem(db, box, ctx)
}

/**
 * One transaction; a reference the deletion would leave behind (foreign key check, only violations it adds) or a
 * refused delete rolls it back with 409 retention_delete_blocked.
 */
function checkedTransaction(db: Db, write: (tx: Db) => number): number {
  const before = new Set(foreignKeyViolations(db))
  try {
    return db.transaction((tx) => {
      const changed = write(tx)
      if (foreignKeyViolations(tx).some(violation => !before.has(violation))) throw new ServiceError(409, 'retention_delete_blocked')
      return changed
    })
  }
  catch (error) {
    if (!(error instanceof ServiceError) && isForeignKeyError(error)) throw new ServiceError(409, 'retention_delete_blocked')
    throw error
  }
}

/** Deletes the item (checked to exist and be due); answers the rows deleted or cleared. */
function removeItem(db: Db, actor: SessionUser, key: ItemKey, ctx: Context, now: Date): number {
  const item = findItem(db, key, ctx)
  if (!item.due) throw new ServiceError(409, 'retention_not_due', item.deletableFrom ? { deletableFrom: item.deletableFrom } : undefined)
  if (key.kind === 'employee') {
    const { category } = key
    if (category === 'record') return checkedTransaction(db, tx => deleteEmployeeRow(tx, key.id))
    if (category === 'bem') {
      const employee = db.select({ leftOn: employees.leftOn }).from(employees).where(eq(employees.id, key.id)).get()!
      const years = ctx.settings(item.facilityId).bemYears
      return checkedTransaction(db, tx => deleteDueBemProcesses(tx, key.id, employee.leftOn, ctx.today, years))
    }
    if (category === 'maternity') {
      const employee = db.select({ leftOn: employees.leftOn }).from(employees).where(eq(employees.id, key.id)).get()!
      const years = ctx.settings(item.facilityId).maternityYears
      return checkedTransaction(db, tx => deleteDueMaternityCases(tx, key.id, employee.leftOn, ctx.today, years))
    }
    const categories = categoriesOf(category as RetentionCategory, ctx.settings(item.facilityId))
    return checkedTransaction(db, (tx) => {
      const counts = deleteCategories(tx, key.id, categories)
      return categories.reduce((sum, one) => sum + counts[one], 0)
    })
  }
  if (key.kind === 'child') {
    return checkedTransaction(db, (tx) => {
      deleteChild(tx, item.facilityId, key.id)
      return 1
    })
  }
  if (key.kind === 'signRequest') return checkedTransaction(db, tx => removeSignRequest(tx, key.id, now))
  // The record with its documents, forms (and days): they go with it (foreign keys).
  if (key.kind === 'infoVisit') return checkedTransaction(db, tx => tx.delete(infoVisits).where(eq(infoVisits.id, key.id)).run().changes)
  if (key.kind === 'applicant') {
    return checkedTransaction(db, tx => tx.delete(applicantVisits).where(eq(applicantVisits.id, key.id)).run().changes)
  }
  const box = db.select().from(cashBoxes).where(eq(cashBoxes.id, key.id)).get()!
  try {
    return removeArchivedBox(db, actor, box, now).rows
  }
  catch (error) {
    // Its own transaction and FK check (rolled back): the same answer as every other item.
    if ((error instanceof ServiceError && error.code === 'cash_box_purge_blocked') || (!(error instanceof ServiceError) && isForeignKeyError(error))) {
      throw new ServiceError(409, 'retention_delete_blocked')
    }
    throw error
  }
}

function assertMayDelete(actor: SessionUser): void {
  if (!can(actor.permissions, 'retention.delete')) throw new ServiceError(403, 'forbidden')
}

/**
 * The Träger deletes one item of the overview, in the item's own facility (never the active one): an employee's
 * category (deleteCategories) or the employee row once nothing else is left, a child record with its contacts and
 * documents, an archived cash box (removeArchivedBox: the counterparts of its transfers stay). Due-ness is checked
 * again: 409 retention_not_due; 404 retention_item_not_found for an item that does not exist (any more), 400
 * retention_key_invalid, 403 forbidden for everyone but the Träger. Answers the rows deleted or cleared (the caller
 * checkpoints the WAL when that is more than 0).
 */
export function deleteRetentionItem(db: Db, actor: SessionUser, key: string, today: IsoDate, now: Date = new Date()): number {
  assertMayDelete(actor)
  return removeItem(db, actor, parseKey(key), context(db, today), now)
}

/**
 * „Alle fälligen löschen“: the given keys (as shown on the page), each in a transaction of its own. Due-ness is
 * decided once before anything is deleted, so an item that only becomes due on the way (a record whose other
 * categories went in the same request) stays until next time; employee records go after the categories. A key not
 * due, gone, invalid or failing in any other way (its transaction rolled back) is skipped and reported (in the order
 * given), the others are deleted. Answers how many items
 * were deleted. 403 forbidden for everyone but the Träger.
 */
export function deleteDueItems(
  db: Db, actor: SessionUser, keys: readonly string[], today: IsoDate, now: Date = new Date(),
): RetentionDeleteResult {
  assertMayDelete(actor)
  const ctx = context(db, today)
  const unique = [...new Set(keys)]
  const skipped = new Set<string>()
  const due: { key: string; parsed: ItemKey }[] = []
  for (const key of unique) {
    try {
      const parsed = parseKey(key)
      if (findItem(db, parsed, ctx).due) due.push({ key, parsed })
      else skipped.add(key)
    }
    catch {
      skipped.add(key)
    }
  }
  const isRecord = (parsed: ItemKey) => parsed.kind === 'employee' && parsed.category === 'record'
  let deleted = 0
  for (const { key, parsed } of [...due.filter(item => !isRecord(item.parsed)), ...due.filter(item => isRecord(item.parsed))]) {
    try {
      removeItem(db, actor, parsed, ctx, now)
      deleted++
    }
    catch {
      // Whatever went wrong, the item's own transaction was rolled back: skip it, go on with the others.
      skipped.add(key)
    }
  }
  return { deleted, skipped: unique.filter(key => skipped.has(key)) }
}
