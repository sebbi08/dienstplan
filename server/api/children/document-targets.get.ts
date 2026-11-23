import { todayIso } from '../../../shared/domain/dates'
import { documentTargets } from '../../services/childDocuments'

/** The children the viewer may add documents to (office account or unlocked tablet): „Ausfüllen“ → „für ein Kind“. */
export default defineServiceHandler(async (event) => {
  const actor = await requireChildPermission(event, 'children.edit')
  return documentTargets(useDb(), actor, actor.facilityId, todayIso())
})
