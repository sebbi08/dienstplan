import { checkpointWal } from '../../../db/client'
import { idParams, payrollSchema } from '../../../schemas'
import { setPayroll } from '../../../services/employeePayroll'

export default defineServiceHandler(async (event) => {
  const actor = await requirePermission(event, 'employees.payroll')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  setPayroll(useDb(), actor.facilityId, id, await readValidatedBody(event, payrollSchema.parse))
  // Replaced or cleared values (IBAN, Steuer-ID ...) leave the WAL file at once, as with the documents.
  checkpointWal(useSqlite())
  return { ok: true }
})
