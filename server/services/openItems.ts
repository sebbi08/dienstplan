import { and, eq, gte, inArray } from 'drizzle-orm'
import { addDays } from '../../shared/domain/dates'
import { can } from '../../shared/domain/permissions'
import type { IsoDate } from '../../shared/domain/types'
import type { MyOpenItemsDto, SessionUser } from '../../shared/types/api'
import type { Db } from '../db/client'
import { employees, leaveRequests } from '../db/schema'
import { openKnowledgeCount } from './knowledge'
import { getMyLeaveForfeitNotice } from './leaveForfeit'
import { getEmployeeRequirements } from './requirements'
import { mySignRequestCount } from './signRequests'
import { listMyTalks } from './staffTalks'

/** How long a decision on an own leave request shows as news („Rückmeldung zum Urlaubsantrag“). */
export const LEAVE_DECISION_DAYS = 14

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
 * remaining leave still to read, and own mandatory appointments that are overdue or never recorded. Only the person's
 * own items, never anyone else's; nothing without a linked employee.
 */
export function myOpenItems(db: Db, viewer: OpenItemsViewer, today: IsoDate): MyOpenItemsDto {
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
  const requirements = getEmployeeRequirements(db, employee.facilityId, employeeId, today).kinds
    .filter(kind => kind.state === 'overdue' || kind.state === 'missing').length
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

