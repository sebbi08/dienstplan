import { codeUpdateSchema, idParams } from '../../schemas'
import { updateCode } from '../../services/settings'

/** The codes apply to every facility, so only the Träger changes them; the Leitung sees them read-only. */
export default defineServiceHandler(async (event) => {
  await requirePermission(event, 'settings.absenceCodes', { facility: 'none' })
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return updateCode(useDb(), id, await readValidatedBody(event, codeUpdateSchema.parse))
})
