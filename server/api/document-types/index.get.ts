import { listDocumentTypes } from '../../services/documentTypes'

/** The document types of the facility; everyone who may see child records needs them to show and pick. */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildReader(event)
  return listDocumentTypes(useDb(), viewer.facilityId)
})
