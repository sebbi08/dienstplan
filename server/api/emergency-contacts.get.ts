import { todayIso } from '../../shared/domain/dates'
import { listAllEmergencyContacts } from '../services/emergencyContacts'

/** The print list „Notfallkontakte aller Mitarbeiter“ of the facility (Leitung and Träger). */
export default defineServiceHandler(async (event) => {
  const viewer = await requirePermission(event, 'employees.view')
  return listAllEmergencyContacts(useDb(), viewer.facilityId, todayIso())
})
