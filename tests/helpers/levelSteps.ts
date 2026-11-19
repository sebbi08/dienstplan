import type { Db } from '../../server/db/client'
import { listEmployeeListExtras } from '../../server/services/employeeListExtras'
import type { EmployeeViewer } from '../../server/services/employees'
import { loadEmployees } from '../../server/services/queries'
import type { IsoDate } from '../../shared/domain/types'

/**
 * The level steps due within a month or overdue, as the „Nächste Stufe“ column of the employee list marks them (nothing
 * without the contract right, nobody who left before today).
 */
export function dueLevelSteps(db: Db, facilityId: number, today: IsoDate, viewer: EmployeeViewer) {
  const names = new Map(loadEmployees(db, facilityId).map(employee => [employee.id, employee.name]))
  return listEmployeeListExtras(db, facilityId, today, viewer).flatMap(({ employeeId, level }) =>
    level && !level.final && level.state !== 'later'
      ? [{ employeeId, name: names.get(employeeId)!, fromLevel: level.fromLevel, level: level.level, on: level.on }]
      : [])
}
