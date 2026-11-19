import { ifsgKeyParams } from '../../../schemas'
import { deleteLocalRule } from '../../../services/ifsgLocal'

/** Removes a local rule (the RKI counts again) or a local disease no case uses; Leitung and Träger. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  const { key } = await getValidatedRouterParams(event, ifsgKeyParams.parse)
  deleteLocalRule(useDb(), admin.facilityId, key)
  return { ok: true }
})
