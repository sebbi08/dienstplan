import { tabletUnlockSchema } from '../../../schemas'
import { unlockForSigning } from '../../../services/signUnlock'

/** „Zu unterschreiben“: a person of the tablet's list with their PIN; a short sign-only unlock (no child records). */
export default defineServiceHandler(async (event) => {
  const terminal = await requireTerminal(event)
  const { employeeId, pin } = await readValidatedBody(event, tabletUnlockSchema.parse)
  // Only the token goes into the session's server-only part; the row in the database is what counts.
  await storeSignUnlockToken(event, unlockForSigning(useDb(), terminal, employeeId, pin))
  return { ok: true }
})
