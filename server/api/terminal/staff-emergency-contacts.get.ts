import { listTabletEmergencyContacts } from '../../services/staffEmergencyConsent'

/** The emergency contacts of the colleagues who consented, for the unlocked tablet only (403 tablet_locked otherwise). */
export default defineServiceHandler(async (event) => {
  const terminal = await requireTerminal(event)
  return listTabletEmergencyContacts(useDb(), terminal, await childUnlockToken(event))
})
