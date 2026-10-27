import { childRetentionSchema } from '../schemas'
import { setChildRetentionYears } from '../services/appSettings'

/** The Träger sets the retention period of the child records (from when a record may be deleted, by hand). */
export default defineServiceHandler(async (event) => {
  await requireProvider(event)
  const { years } = await readValidatedBody(event, childRetentionSchema.parse)
  setChildRetentionYears(useDb(), years)
  return { ok: true }
})
