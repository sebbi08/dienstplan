import { can } from '../../shared/domain/permissions'
import { probationRunning } from '../../shared/domain/probation'
import { levelStart, levelStepState, nextLevelStep } from '../../shared/domain/tvoed'
import type { IsoDate } from '../../shared/domain/types'
import type { EmployeeListExtrasDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import type { EmployeeViewer } from './employees'
import { getLeaveForfeitStatuses } from './leaveForfeit'
import { loadEmployees, type EmployeeRecord } from './queries'
import { listDueRequirements } from './requirements'

/** The next level step of one employee (null without a level or a start of employment). */
function levelOf(employee: EmployeeRecord, today: IsoDate): EmployeeListExtrasDto['level'] {
  if (!employee.employedSince) return null
  if (employee.payLevel !== null && employee.payLevel >= 6) return { final: true }
  const since = levelStart(employee.employedSince, employee.trainingUntil, employee.recognitionYearCounts)
  const next = nextLevelStep(since, employee.payLevel)
  return next ? { final: false, fromLevel: employee.payLevel!, ...next, state: levelStepState(next.on, today) } : null
}

/**
 * What the employee list shows beside each person, in one go (no request per row): „Nächste Stufe“ and „in Probezeit
 * bis …“ while the probation period runs (employees.contractView),
 * the mandatory appointments that are open (everyone who sees the list) and the state of the notice on remaining leave
 * (leave.overview). A part the viewer may not see is left out of the row (the key is absent). Staff who left before
 * today are skipped, as in the level-up notice.
 */
export function listEmployeeListExtras(db: Db, facilityId: number, today: IsoDate, viewer: EmployeeViewer): EmployeeListExtrasDto[] {
  const withLevel = can(viewer, 'employees.contractView')
  const withForfeit = can(viewer, 'leave.overview')
  const open = new Map<number, EmployeeListExtrasDto['requirements']>()
  for (const due of listDueRequirements(db, facilityId, today)) {
    const rows = open.get(due.employeeId) ?? []
    rows.push({ typeId: due.typeId, typeName: due.typeName, state: due.state, dueOn: due.dueOn })
    open.set(due.employeeId, rows)
  }
  const forfeit = withForfeit ? getLeaveForfeitStatuses(db, facilityId, today) : null
  return loadEmployees(db, facilityId)
    .filter(employee => employee.leftOn === null || employee.leftOn >= today)
    .map((employee) => {
      const row: EmployeeListExtrasDto = { employeeId: employee.id, requirements: open.get(employee.id) ?? [] }
      if (withLevel) {
        row.level = levelOf(employee, today)
        row.probationUntil = probationRunning(employee.probationUntil, today) ? employee.probationUntil : null
      }
      if (withForfeit) {
        const status = forfeit?.rows.get(employee.id)
        row.forfeit = forfeit && status
          ? { year: forfeit.year, status: status.status === 'reopened' ? 'open' : status.status, readAt: status.readAt }
          : null
      }
      return row
    })
}
