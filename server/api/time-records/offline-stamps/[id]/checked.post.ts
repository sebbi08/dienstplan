import { idParams } from '../../../../schemas'
import { checkOfflineStampHint } from '../../../../services/offlineStamps'

/** „Geprüft“ on the review list of offline stamps. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'time.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  checkOfflineStampHint(useDb(), admin, admin.facilityId, id)
  return { ok: true }
})
