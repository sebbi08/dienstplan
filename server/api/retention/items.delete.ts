import { todayIso } from '../../../shared/domain/dates'
import { checkpointWal } from '../../db/client'
import { retentionItemSchema } from '../../schemas'
import { deleteRetentionItem } from '../../services/retentionOverview'

/** The Träger deletes one due item of the retention overview, `key` in the body; answers the rows deleted. */
export default defineServiceHandler(async (event): Promise<{ deleted: number }> => {
  const provider = await requireProvider(event)
  const { key } = await readValidatedBody(event, retentionItemSchema.parse)
  const deleted = deleteRetentionItem(useDb(), provider, key, todayIso())
  // The deleted rows must not linger in the write-ahead log.
  if (deleted > 0) checkpointWal(useSqlite())
  return { deleted }
})
