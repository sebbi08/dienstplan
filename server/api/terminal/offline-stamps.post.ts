import { tabletStatus } from '../../../shared/domain/offlineStamps'
import { offlineStampsSchema } from '../../schemas'
import { ServiceError } from '../../lib/errors'
import { allowOfflineSync, syncOfflineStamps } from '../../services/offlineStamps'

/**
 * The tablet's offline queue (docs/BETRIEB.md „Stempeln ohne Netz am Tablet“): every stamp named in the answer leaves
 * the queue. The tablet learns only done/rejected per stamp (no reason, so the answer does not tell whether a PIN was
 * right); at most 10 requests per minute and tablet account (429 too_many_requests).
 */
export default defineServiceHandler(async (event) => {
  const terminal = await requireTerminal(event)
  if (!allowOfflineSync(terminal.id)) throw new ServiceError(429, 'too_many_requests')
  const body = await readValidatedBody(event, offlineStampsSchema.parse)
  const { results } = syncOfflineStamps(useDb(), terminal.facilityId, body)
  return { results: results.map(result => ({ clientId: result.clientId, status: tabletStatus(result.status) })) }
})
