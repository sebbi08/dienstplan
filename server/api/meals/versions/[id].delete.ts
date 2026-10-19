import { idParams } from '../../../schemas'
import { cancelMealVersion, listMeals } from '../../../services/meals'

/** Takes back a change of a meal of the active facility from today or later; answers the meals as they are afterwards. */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const db = useDb()
  cancelMealVersion(db, admin.facilityId, id)
  return listMeals(db, admin.facilityId)
})
