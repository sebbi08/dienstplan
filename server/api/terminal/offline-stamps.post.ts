import { offlineStampsSchema } from '../../schemas'
import { syncOfflineStamps } from '../../services/offlineStamps'

/** The tablet's offline queue: every stamp named in the answer leaves the queue (docs/BETRIEB.md „Stempeln ohne Netz am Tablet“). */
export default defineServiceHandler(async (event) => {
  const terminal = await requireTerminal(event)
  const body = await readValidatedBody(event, offlineStampsSchema.parse)
  return syncOfflineStamps(useDb(), terminal.facilityId, body)
})
