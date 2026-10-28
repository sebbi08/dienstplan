import { setupItemParams } from '../../../schemas'
import { showSetupItem } from '../../../services/setupChecklist'

/** „Wieder einblenden“: shows a hidden item of „Was noch fehlt“ of the active facility again (already shown: no change). */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  const { key } = await getValidatedRouterParams(event, setupItemParams.parse)
  showSetupItem(useDb(), admin, admin.facilityId, key)
  return { ok: true }
})
