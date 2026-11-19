import { listIfsgDocuments } from '../../../services/ifsgLocal'

/** The local health office's documents for the readmission; every child viewer reads them, also at the tablet. */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildPermission(event, 'children.view')
  return listIfsgDocuments(useDb(), viewer.facilityId)
})
