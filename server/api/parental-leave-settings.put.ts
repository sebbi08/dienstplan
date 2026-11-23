import type { ParentalLeaveSettingsDto } from '../../shared/types/api'
import { parentalLeaveSettingsSchema } from '../schemas'
import { setParentalLeaveSettings } from '../services/parentalLeave'

/** Switches „Elternzeit für alle sichtbar anzeigen“ (whoever edits the contract data, the Träger by default). */
export default defineServiceHandler(async (event): Promise<ParentalLeaveSettingsDto> => {
  const admin = await requirePermission(event, 'employees.contractEdit')
  const { visibleToAll } = await readValidatedBody(event, parentalLeaveSettingsSchema.parse)
  return setParentalLeaveSettings(useDb(), admin, admin.facilityId, visibleToAll)
})
