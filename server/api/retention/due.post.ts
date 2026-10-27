import { todayIso } from '../../../shared/domain/dates'
import type { RetentionDeleteResult } from '../../../shared/types/api'
import { checkpointWal } from '../../db/client'
import { retentionDueSchema } from '../../schemas'
import { deleteDueItems } from '../../services/retentionOverview'

/**
 * „Alle fälligen löschen“: the Träger deletes the due items shown on the page (`keys`, at most 1000); keys not due,
 * gone or invalid are skipped and reported.
 */
export default defineServiceHandler(async (event): Promise<RetentionDeleteResult> => {
  const provider = await requireProvider(event)
  const { keys } = await readValidatedBody(event, retentionDueSchema.parse)
  let result: RetentionDeleteResult | undefined
  try {
    result = deleteDueItems(useDb(), provider, keys, todayIso())
    return result
  }
  finally {
    // The deleted rows must not linger in the write-ahead log (also when an unexpected error stopped halfway).
    if (result === undefined || result.deleted > 0) checkpointWal(useSqlite())
  }
})
