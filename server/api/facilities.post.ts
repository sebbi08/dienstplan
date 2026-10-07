import { facilityNameSchema } from '../schemas'
import { createFacility } from '../services/facilities'

export default defineServiceHandler(async (event) => {
  await requireProvider(event)
  const { name } = await readValidatedBody(event, facilityNameSchema.parse)
  return createFacility(useDb(), name)
})
