import { noteInputSchema } from '../../schemas'
import { createNote } from '../../services/facilityNotes'

/** A new note of the active facility (notes.write; with the own-group scope only for the own group). */
export default defineServiceHandler(async (event) => {
  const user = await requirePermission(event, 'notes.write', { facility: 'active' })
  const body = await readValidatedBody(event, noteInputSchema.parse)
  return createNote(useDb(), user, body)
})
