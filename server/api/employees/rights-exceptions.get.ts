import { listRightsExceptions } from '../../services/rights'

/** The column „Sonderrechte“ on the staff list: for the Träger and the Leitung only (the service checks). */
export default defineServiceHandler(async (event) => {
  const viewer = await requirePermission(event, 'employees.view')
  return listRightsExceptions(useDb(), viewer, viewer.facilityId)
})
