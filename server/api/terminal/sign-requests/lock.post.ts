import { lockSigning } from '../../../services/signUnlock'

/** Ends the tablet's sign-only unlock (Fertig, the start page, the idle timer). */
export default defineServiceHandler(async (event) => {
  const terminal = await requireTerminal(event)
  lockSigning(useDb(), terminal.id, await signUnlockToken(event))
  return { ok: true }
})
