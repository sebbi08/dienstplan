import { formRevisionParams } from '../../../../../schemas'
import { getTalkFormRevision } from '../../../../../services/staffTalks'

/** One stored state of a talk's form („Stand vom …“; Leitung and Träger). */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'talks.manage')
  // Never the manager's own talks: those are held by the Träger or another Leitung.
  const scope = { facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }
  const { formId, revisionId } = await getValidatedRouterParams(event, formRevisionParams.parse)
  return getTalkFormRevision(useDb(), scope, formId, revisionId)
})
