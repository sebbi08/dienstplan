import { checkpointWal } from '../../../db/client'
import { applicantHireSchema, idParams } from '../../../schemas'
import { hireApplicant } from '../../../services/visits'

/**
 * „Einstellen“: creates the employee and moves documents (into the chosen folder) and forms into the personnel file; the
 * service also asks for the right to create employees and the folder's key (403).
 */
export default defineServiceHandler(async (event): Promise<{ employeeId: number; contactCopied: boolean }> => {
  const actor = await requirePermission(event, 'visits.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, applicantHireSchema.parse)
  const result = hireApplicant(useDb(), actor, id, body)
  checkpointWal(useSqlite())
  return result
})
