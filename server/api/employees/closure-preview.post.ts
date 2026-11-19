import { closurePreviewSchema } from '../../schemas'
import { previewClosuresForNew } from '../../services/closurePreview'

/** „Schließzeiten als Urlaub“ in the create form: computed from the typed values, nothing is written. */
export default defineServiceHandler(async (event) => {
  const actor = await requirePermission(event, 'employees.edit')
  const body = await readValidatedBody(event, closurePreviewSchema.parse)
  return previewClosuresForNew(useDb(), actor.facilityId, body)
})
