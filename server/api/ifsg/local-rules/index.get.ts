import { localRulesOverview } from '../../../services/ifsgLocal'

/** „Wiederzulassung (Gesundheitsamt)“: per disease the RKI rule beside the local one (Leitung and Träger). */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'settings.facility')
  return localRulesOverview(useDb(), admin.facilityId)
})
