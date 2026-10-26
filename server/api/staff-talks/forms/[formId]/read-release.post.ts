import { formIdParams, readReleaseSchema } from '../../../../schemas'
import { setTalkFormReadRelease } from '../../../../services/staffTalks'

/** „Zum Lesen freigeben“ (released: true) or takes it back (false) for an assessment. */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { formId } = await getValidatedRouterParams(event, formIdParams.parse)
  const { released } = await readValidatedBody(event, readReleaseSchema.parse)
  setTalkFormReadRelease(useDb(), admin.facilityId, formId, released)
  return { ok: true }
})
