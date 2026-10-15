import { tabletUnlockSchema } from '../../../schemas'
import { unlockChildren } from '../../../services/tabletUnlock'

export default defineServiceHandler(async (event) => {
  const terminal = await requireTerminal(event)
  const { employeeId, pin } = await readValidatedBody(event, tabletUnlockSchema.parse)
  const { token, status } = unlockChildren(useDb(), terminal, employeeId, pin)
  // Only the token goes into the session's server-only part; the row in the database is what counts.
  await storeChildUnlockToken(event, token)
  return status
})
