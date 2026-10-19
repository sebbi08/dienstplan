import { listMeals } from '../../services/meals'

/** The meals of the active facility today and the changes planned after today (Leitung and Träger). */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  return listMeals(useDb(), admin.facilityId)
})
