import type { SetupChecklist } from '../../../shared/domain/setupChecklist'
import { getSetupChecklist } from '../../services/setupChecklist'

/** „Was noch fehlt“ of the active facility for the Leitung or the Träger (items for the Träger only: Träger alone). */
export default defineServiceHandler(async (event): Promise<SetupChecklist> => {
  const admin = await requirePermission(event, 'settings.facility')
  return getSetupChecklist(useDb(), admin, admin.facilityId)
})
