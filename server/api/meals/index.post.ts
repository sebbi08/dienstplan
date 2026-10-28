import { mealSchema } from '../../schemas'
import { addMeal, listMeals } from '../../services/meals'

/** A new meal of the active facility from a day on; answers the meals as they are afterwards. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  const input = await readValidatedBody(event, mealSchema.parse)
  const db = useDb()
  addMeal(db, admin.facilityId, input)
  return listMeals(db, admin.facilityId)
})
