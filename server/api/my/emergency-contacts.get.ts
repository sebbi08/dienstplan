import { getMyEmergencyContacts } from '../../services/staffEmergencyConsent'

/** The own emergency contacts as colleagues would see them at the tablet (no note); the employee follows from the session. */
export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  return getMyEmergencyContacts(useDb(), user)
})
