import { todayIso } from '../../../../shared/domain/dates'
import { checkpointWal } from '../../../db/client'
import { employeeChildrenSchema, idParams } from '../../../schemas'
import { setEmployeeChildren } from '../../../services/employeeChildren'

/** Saves the section „Kinder“ at once (employees.edit; the service asks for employees.personal as well, 403). */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const result = setEmployeeChildren(
    useDb(), admin.facilityId, id, await readValidatedBody(event, employeeChildrenSchema.parse), admin.permissions, todayIso(),
  )
  // Replaced or removed personal data leave the WAL file at once, as with the personal block.
  checkpointWal(useSqlite())
  return result
})
