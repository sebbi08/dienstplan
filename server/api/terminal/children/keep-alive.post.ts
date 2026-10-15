import { tabletChildViewer, tabletUnlockStatus } from '../../../services/tabletUnlock'

/** The tablet reports use; keeps the unlock alive (403 tablet_locked when it has run out). */
export default defineServiceHandler(async (event) => {
  const terminal = await requireTerminal(event)
  const { childUnlock } = await getUserSession(event)
  const db = useDb()
  tabletChildViewer(db, terminal, childUnlock)
  return tabletUnlockStatus(db, terminal, childUnlock)
})
