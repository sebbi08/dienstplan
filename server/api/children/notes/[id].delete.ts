import { idParams } from '../../../schemas'
import { deleteNote } from '../../../services/childNotes'

/** Deletes a note: its author, Leitung and Träger (checked by the service). */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildPermission(event, 'children.view')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteNote(useDb(), viewer, id)
  return { ok: true }
})
