import type { GermanState } from '../../shared/domain/states'
import { facilityCreateSchema } from '../schemas'
import { createFacility } from '../services/facilities'

export default defineServiceHandler(async (event) => {
  await requireProvider(event)
  const { name, state } = await readValidatedBody(event, facilityCreateSchema.parse)
  // An unknown code is refused by the service (400 state_invalid); a missing one means Baden-Württemberg.
  return createFacility(useDb(), name, state as GermanState | undefined)
})
