import { listRequirementTypes } from '../services/requirements'

/** The kinds of mandatory appointments of the facility the manager works in. */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  return listRequirementTypes(useDb(), admin.facilityId)
})
