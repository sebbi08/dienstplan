import { childRetentionSchema } from '../schemas'
import { setChildRetentionYears } from '../services/appSettings'

/**
 * The Träger sets the retention period of the child records. `autoLeaveSwitchedOff`: another period switched the
 * automatic leaving of school children off in at least one facility.
 */
export default defineServiceHandler(async (event) => {
  await requireProvider(event)
  const { years } = await readValidatedBody(event, childRetentionSchema.parse)
  const { autoLeaveSwitchedOff } = setChildRetentionYears(useDb(), years)
  return { ok: true, autoLeaveSwitchedOff }
})
