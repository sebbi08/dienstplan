import { checkpointWal } from '../../../db/client'
import { idParams, infoVisitTakeOverSchema } from '../../../schemas'
import { takeOverInfoVisit } from '../../../services/visits'

/**
 * „Als Vormerkung übernehmen“: creates the waitlist child and moves documents and forms; the service also asks for the
 * right to create children (403). The documents' old rows leave the WAL at once.
 */
export default defineServiceHandler(async (event): Promise<{ childId: number }> => {
  const actor = await requirePermission(event, 'visits.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, infoVisitTakeOverSchema.parse)
  const childId = takeOverInfoVisit(useDb(), actor, id, body)
  checkpointWal(useSqlite())
  return { childId }
})
