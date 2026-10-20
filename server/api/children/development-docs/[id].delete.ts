import { idParams } from '../../../schemas'
import { undoDocDone } from '../../../services/reminders'

/** Takes an „Erledigt“ of the development documentation back (staff on its day, Leitung and Träger any time). */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildReader(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  undoDocDone(useDb(), viewer, id)
  return { ok: true }
})
