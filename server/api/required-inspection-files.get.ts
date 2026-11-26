import { storedInspectionFileList } from '../services/requiredDocuments'

/**
 * Files still kept for Pflichtdokumente „nur Einsicht vermerken“ (an old Führungszeugnis upload; § 72a Abs. 5 SGB VIII:
 * not to be kept) – for the notice under Datenschutz & Löschen, only in folders the viewer may use.
 */
export default defineServiceHandler(async (event) => {
  const viewer = await requirePermission(event, 'employees.view')
  return storedInspectionFileList(useDb(), viewer, viewer.facilityId)
})
