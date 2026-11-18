import { childNoteSchema, idParams } from '../../../schemas'
import { updateNote } from '../../../services/childNotes'

/** Changes a note: its author, Leitung and Träger (checked by the service). */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildPermission(event, 'children.attendance')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, childNoteSchema.parse)
  updateNote(useDb(), viewer, id, body)
  return { ok: true }
})
