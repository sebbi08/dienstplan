import { and, eq, gte, inArray } from 'drizzle-orm'
import { addDays } from '../../shared/domain/dates'
import { can } from '../../shared/domain/permissions'
import { employmentStart } from '../../shared/domain/targets'
import type { IsoDate } from '../../shared/domain/types'
import type { MyOpenItemsDto, SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees, leaveRequests } from '../db/schema'
import { unconfirmedAttendance } from './eventRequirements'
import { openKnowledgeCount } from './knowledge'
import { getMyLeaveForfeitNotice } from './leaveForfeit'
import { loadEmployee } from './queries'
import { getEmployeeRequirements } from './requirements'
import { mySignRequestCount } from './signRequests'
import { listMyTalks } from './staffTalks'

/** How long a decision on an own leave request shows as news („Rückmeldung zum Urlaubsantrag“). */
export const LEAVE_DECISION_DAYS = 14

/** A Pflichttermin never entered counts as open only after the person's first weeks (time to bring the proofs). */
export const NEW_STAFF_GRACE_DAYS = 28

/** The person who asks: the account with its linked employee, its active facility and home group. */
export type OpenItemsViewer = SessionUser & { homeGroupId?: number | null }

/** Nothing open: an account without a linked employee has no own to-dos. */
const NOTHING: MyOpenItemsDto = {
  knowledge: 0, sign: 0, signOverdue: 0, selfAssessments: 0, leaveDecisions: 0, leaveNotice: false, requirements: 0,
}

/**
 * „Offen für dich“: what waits for the account's own linked employee, each counted by the service that owns it (the same
 * counts as the menu and the pages behind the links) – entries of „Wissen“ to confirm, requests to sign (and how many of
 * them are overdue), self-assessments to fill in, decisions on own leave requests of the last 14 days, the notice on
 * remaining leave still to read, and own mandatory appointments that are overdue – one never entered only after the
 * first 4 weeks of employment, so a new person is not greeted with every kind at once. Only the person's own items,
 * never anyone else's; nothing without a linked employee. Besides, for whoever enters Pflichttermine and edits the
 * calendar (Leitung, Träger – also without a linked employee): the Pflichttermin appointments of the active facility
 * whose attendance is still to be confirmed („Teilnahme bestätigen“, from their last day on).
 */
export function myOpenItems(db: Db, viewer: OpenItemsViewer, today: IsoDate): MyOpenItemsDto {
  const own = ownOpenItems(db, viewer, today)
  const unconfirmed = viewer.facilityId !== null && can(viewer.permissions, 'employees.edit') && can(viewer.permissions, 'calendar.edit')
    ? unconfirmedAttendance(db, viewer.facilityId, today)
    : []
  const first = unconfirmed[0]
  return first ? { ...own, attendance: { count: unconfirmed.length, eventId: first.id, year: Number(first.date.slice(0, 4)) } } : own
}

function ownOpenItems(db: Db, viewer: OpenItemsViewer, today: IsoDate): MyOpenItemsDto {
  const employeeId = viewer.employeeId
  if (employeeId === null) return NOTHING
  const employee = db.select({ facilityId: employees.facilityId }).from(employees).where(eq(employees.id, employeeId)).get()
  if (!employee) return NOTHING
  const knowledge = can(viewer.permissions, 'knowledge.view') && viewer.facilityId !== null
    ? openKnowledgeCount(db, { ...viewer, facilityId: viewer.facilityId })
    : 0
  const sign = mySignRequestCount(db, employeeId, today)
  const selfAssessments = can(viewer.permissions, 'talks.own')
    ? listMyTalks(db, viewer).flatMap(talk => talk.forms).filter(form => form.role === 'self' && form.state === 'released').length
    : 0
  const since = addDays(today, -LEAVE_DECISION_DAYS)
  const leaveDecisions = can(viewer.permissions, 'leave.request')
    ? db.select({ id: leaveRequests.id }).from(leaveRequests).where(and(
        eq(leaveRequests.employeeId, employeeId), inArray(leaveRequests.status, ['approved', 'rejected']), gte(leaveRequests.decidedAt, since),
      )).all().length
    : 0
  const start = employmentStart(loadEmployee(db, employeeId)!.info)
  const settled = start !== null && addDays(start, NEW_STAFF_GRACE_DAYS) <= today
  const requirements = getEmployeeRequirements(db, employee.facilityId, employeeId, today).kinds
    .filter(kind => kind.state === 'overdue' || (kind.state === 'missing' && settled)).length
  return {
    knowledge,
    sign: sign.count,
    signOverdue: sign.overdue,
    selfAssessments,
    leaveDecisions,
    leaveNotice: getMyLeaveForfeitNotice(db, viewer, today) !== null,
    requirements,
  }
}

