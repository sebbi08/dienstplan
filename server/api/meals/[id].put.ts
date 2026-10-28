import { idParams, mealSchema } from '../../schemas'
import { changeMeal, listMeals } from '../../services/meals'

/** Name and time of a meal of the active facility from a day on; answers the meals as they are afterwards. */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const input = await readValidatedBody(event, mealSchema.parse)
  const db = useDb()
  changeMeal(db, admin.facilityId, id, input)
  return listMeals(db, admin.facilityId)
})
