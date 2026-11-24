import { formIdParams, formRevisionsQuery } from '../../../../../schemas'
import { listTalkFormRevisions } from '../../../../../services/staffTalks'

/** „Verlauf“ of a talk's form, newest first and paged (Leitung and Träger). */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'talks.manage')
  // Never the manager's own talks: those are held by the Träger or another Leitung.
  const scope = { facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }
  const { formId } = await getValidatedRouterParams(event, formIdParams.parse)
  const { offset } = await getValidatedQuery(event, formRevisionsQuery.parse)
  return listTalkFormRevisions(useDb(), scope, formId, offset)
})
