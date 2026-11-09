import { idParams, noteInputSchema } from '../../schemas'
import { updateNote } from '../../services/facilityNotes'

/** Changes a note of the active facility (notes.write; with the own-group scope only the own group's notes). */
export default defineServiceHandler(async (event) => {
  const user = await requirePermission(event, 'notes.write', { facility: 'active' })
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, noteInputSchema.parse)
  return updateNote(useDb(), user, id, body)
})
