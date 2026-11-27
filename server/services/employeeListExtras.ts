import { can } from '../../shared/domain/permissions'
import { EMPLOYEE_DOCUMENT_FOLDERS, FOLDER_PERMISSION } from '../../shared/domain/personnel'
import { probationRunning } from '../../shared/domain/probation'
import { levelStepState } from '../../shared/domain/tvoed'
import type { IsoDate } from '../../shared/domain/types'
import type { EmployeeListExtrasDto } from '../../shared/types/api'
import type { Db } from '../db/client'
import type { EmployeeViewer } from './employees'
import { plannedRequirements } from './eventRequirements'
import { getLeaveForfeitStatuses } from './leaveForfeit'
import { shiftedLevelStep } from './parentalLeave'
import { loadEmployees, type EmployeeRecord } from './queries'
import { missingRequiredDocuments } from './requiredDocuments'
import { listDueRequirements, listRequirementTypes } from './requirements'

/** The next level step of one employee, moved by Elternzeit (null without a level or a start of employment). */
function levelOf(employee: EmployeeRecord, today: IsoDate): EmployeeListExtrasDto['level'] {
  if (!employee.employedSince) return null
  if (employee.payLevel !== null && employee.payLevel >= 6) return { final: true }
  const next = shiftedLevelStep(employee)
  return next
    ? { final: false, fromLevel: employee.payLevel!, level: next.level, on: next.on, state: levelStepState(next.on, today), shiftDays: next.days }
    : null
}

/**
 * What the employee list shows beside each person, in one go (no request per row): „Nächste Stufe“ and „in Probezeit
 * bis …“ while the probation period runs (employees.contractView),
 * the mandatory appointments that are open (everyone who sees the list) and the state of the notice on remaining leave
 * (leave.overview), and the Pflichtdokumente missing or expired (types in folders the viewer may use; absent without
 * any folder key). A part the viewer may not see is left out of the row (the key is absent). Staff who left before
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
  // „geplant am …“: the Pflichttermin appointments ahead, per person in the order of the kinds.
  const planned = plannedRequirements(db, facilityId, today)
  const kinds = planned.size ? listRequirementTypes(db, facilityId) : []
  const plannedOf = (employeeId: number) => kinds.flatMap((kind) => {
    const next = planned.get(`${employeeId}:${kind.id}`)
    return next ? [{ ...next, typeId: kind.id, typeName: kind.name }] : []
  })
  const forfeit = withForfeit ? getLeaveForfeitStatuses(db, facilityId, today) : null
  const required = EMPLOYEE_DOCUMENT_FOLDERS.some(folder => can(viewer, FOLDER_PERMISSION[folder]))
    ? missingRequiredDocuments(db, { permissions: viewer }, facilityId, today)
    : null
  return loadEmployees(db, facilityId)
    .filter(employee => employee.leftOn === null || employee.leftOn >= today)
    .map((employee) => {
      const row: EmployeeListExtrasDto = { employeeId: employee.id, requirements: open.get(employee.id) ?? [] }
      const ahead = plannedOf(employee.id)
      if (ahead.length) row.plannedRequirements = ahead
      if (required) {
        row.requiredDocuments = (required.get(employee.id) ?? []).map(({ typeId, name, state }) => ({ typeId, name, state: state === 'expired' || state === 'entry' ? state : 'missing' }))
      }
      if (withLevel) {
        row.level = levelOf(employee, today)
        row.probationUntil = probationRunning(employee.probationUntil, today) ? employee.probationUntil : null
      }
      if (withForfeit) {
        const status = forfeit?.rows.get(employee.id)
        // Leave an Elternzeit protects has its own notice and date (§ 17 Abs. 2 BEEG): shown when no usual one runs.
        const moved = forfeit?.protectedRows.get(employee.id)
        row.forfeit = forfeit && forfeit.year !== null && status
          ? { year: forfeit.year, status: status.status === 'reopened' ? 'open' : status.status, readAt: status.readAt, protectedUntil: null }
          : moved
            ? { year: moved.year, status: moved.status === 'reopened' ? 'open' : moved.status, readAt: moved.readAt, protectedUntil: moved.protectedUntil }
            : null
      }
      return row
    })
}
