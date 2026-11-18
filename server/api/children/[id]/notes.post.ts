import { childNoteSchema, idParams } from '../../../schemas'
import { addNote } from '../../../services/childNotes'

/** Enters a note in the child's record: everyone who sees the record may (the service checks the child and the group). */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildPermission(event, 'children.view')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const body = await readValidatedBody(event, childNoteSchema.parse)
  return { id: addNote(useDb(), viewer, id, body) }
})
