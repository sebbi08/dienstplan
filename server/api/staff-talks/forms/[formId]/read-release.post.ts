import { formIdParams, readReleaseSchema } from '../../../../schemas'
import { setTalkFormReadRelease } from '../../../../services/staffTalks'

/** „Zum Lesen freigeben“ (released: true) or takes it back (false) for an assessment. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'talks.manage')
  // Never the manager's own talks: those are held by the Träger or another Leitung.
  const scope = { facilityId: admin.facilityId, ownEmployeeId: admin.employeeId }
  const { formId } = await getValidatedRouterParams(event, formIdParams.parse)
  const { released } = await readValidatedBody(event, readReleaseSchema.parse)
  setTalkFormReadRelease(useDb(), scope, formId, released)
  return { ok: true }
})
