import type { ApplicationFormDto } from '../../../../shared/types/api'
import { idParams } from '../../../schemas'
import { listApplicationForms } from '../../../services/visits'

/**
 * The forms of the application moved into the personnel file at „Einstellen“, read only; the service shows them to
 * whoever may use the folder „Bewerbung“ or holds visits.manage (anyone else gets an empty list).
 */
export default defineServiceHandler(async (event): Promise<ApplicationFormDto[]> => {
  const actor = await requirePermission(event, 'employees.view')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return listApplicationForms(useDb(), actor, id)
})
