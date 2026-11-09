import { idParams } from '../../schemas'
import { deleteNote } from '../../services/facilityNotes'

/** Deletes a note of the active facility (notes.write; with the own-group scope only the own group's notes). */
export default defineServiceHandler(async (event) => {
  const user = await requirePermission(event, 'notes.write', { facility: 'active' })
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  deleteNote(useDb(), user, id)
  return { ok: true }
})
