import { todayIso } from '../../../shared/domain/dates'
import type { EmployeeListExtrasDto } from '../../../shared/types/api'
import { listEmployeeListExtras } from '../../services/employeeListExtras'

/**
 * What the employee list shows beside each person (next level, open mandatory appointments, leave notice) in one answer;
 * each part only as far as the viewer's rights go (contractView, leave.overview).
 */
export default defineServiceHandler(async (event): Promise<EmployeeListExtrasDto[]> => {
  const viewer = await requirePermission(event, 'employees.view')
  return listEmployeeListExtras(useDb(), viewer.facilityId, todayIso(), viewer.permissions)
})
