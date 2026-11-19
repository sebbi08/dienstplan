import { myEmergencyConsentSchema } from '../../schemas'
import { setMyEmergencyConsent } from '../../services/staffEmergencyConsent'

/** The employee gives or withdraws the consent themselves: the employee follows from the session alone. */
export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  const { consent } = await readValidatedBody(event, myEmergencyConsentSchema.parse)
  return setMyEmergencyConsent(useDb(), user, consent)
})
