import { getMyEmergencyConsent } from '../../services/staffEmergencyConsent'

/** The own consent that colleagues see the own emergency contacts at the tablet (403 no_employee without a linked employee). */
export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  return getMyEmergencyConsent(useDb(), user)
})
