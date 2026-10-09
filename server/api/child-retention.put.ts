import { childRetentionSchema } from '../schemas'
import { setChildRetentionYears } from '../services/appSettings'

export default defineServiceHandler(async (event) => {
  await requireProvider(event)
  const { years } = await readValidatedBody(event, childRetentionSchema.parse)
  setChildRetentionYears(useDb(), years)
  return { ok: true }
})
