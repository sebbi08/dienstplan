import { idParams, mealRemoveSchema } from '../../schemas'
import { listMeals, removeMeal } from '../../services/meals'

/**
 * A meal of the active facility is gone from a day on (`validFrom` in the query, or in the body); earlier days keep it.
 * Answers the meals as they are afterwards.
 */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { validFrom } = getQuery(event).validFrom !== undefined
    ? await getValidatedQuery(event, mealRemoveSchema.parse)
    : await readValidatedBody(event, mealRemoveSchema.parse)
  const db = useDb()
  removeMeal(db, admin.facilityId, id, validFrom)
  return listMeals(db, admin.facilityId)
})
