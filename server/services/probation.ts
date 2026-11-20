import { can, type PermissionKey } from '../../shared/domain/permissions'
import { probationReminderState } from '../../shared/domain/probation'
import type { IsoDate } from '../../shared/domain/types'
import type { ReminderDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import { loadEmployees } from './queries'

/**
 * „Probezeit von ‹Name› endet am ‹Datum›“ for whoever sees the contract data (employees.contractView: the Träger, the
 * Leitung with „Vertragsangaben ansehen“), not at the shared tablet: from 4 weeks before the last day of the probation
 * period through that day, for employees of the facility who have not left before it.
 */
export function probationReminders(
  db: Db, viewer: { facilityId: number; permissions: ReadonlySet<PermissionKey>; onTablet: boolean }, today: IsoDate,
): ReminderDto[] {
  if (!can(viewer.permissions, 'employees.contractView') || viewer.onTablet) return []
  return loadEmployees(db, viewer.facilityId).flatMap((employee) => {
    const until = employee.probationUntil
    if (until === null || (employee.leftOn !== null && employee.leftOn < until)) return []
    const state = probationReminderState(until, today)
    if (state === null) return []
    return [{
      kind: 'probation', date: until, state, name: employee.name, childId: null, age: null, ownChild: false, canDone: false,
      time: null, meetingKind: null, count: null, probation: { employeeId: employee.id },
    } satisfies ReminderDto]
  })
}
