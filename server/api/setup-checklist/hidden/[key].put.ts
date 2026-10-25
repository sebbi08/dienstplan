import { setupItemParams } from '../../../schemas'
import { hideSetupItem } from '../../../services/setupChecklist'

/** „Brauchen wir nicht“: hides an item of „Was noch fehlt“ for every Leitung and the Träger of the active facility. */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { key } = await getValidatedRouterParams(event, setupItemParams.parse)
  hideSetupItem(useDb(), admin, admin.facilityId, key)
  return { ok: true }
})
