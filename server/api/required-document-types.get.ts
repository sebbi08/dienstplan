import { listRequiredTypes } from '../services/requiredDocuments'

/** The facility's Pflichtdokumente in their order, only those in folders the viewer may use. */
export default defineServiceHandler(async (event) => {
  const viewer = await requirePermission(event, 'employees.view')
  return listRequiredTypes(useDb(), viewer, viewer.facilityId)
})
