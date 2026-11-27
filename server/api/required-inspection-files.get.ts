import type { InspectionCleanupDto } from '../../shared/types/api'
import { listFacilities } from '../services/facilities'
import { orphanInspectionHistory, storedInspectionFileList } from '../services/requiredDocuments'
import { criminalRecordNotes } from '../services/requirements'

/**
 * What § 72a Abs. 5 SGB VIII does not let the Träger keep, for the notice under Datenschutz & Löschen (deleted by hand,
 * never by the app), in every facility the viewer may see (the Träger: all, like the list below it): files of a
 * Pflichtdokument „nur Einsicht vermerken“ (an old Führungszeugnis upload, or a signed copy that came in after the switch;
 * only in folders the viewer may use) and notes on entries of the Pflichttermin „Erweitertes Führungszeugnis“. Also the
 * audit lines of inspection records whose type is gone (deleted, or removed on a move), in folders the viewer may use.
 */
export default defineServiceHandler(async (event): Promise<InspectionCleanupDto> => {
  const viewer = await requirePermission(event, 'employees.view')
  const db = useDb()
  const facilities = listFacilities(db, viewer).facilities
  return {
    files: storedInspectionFileList(db, viewer, facilities), notes: criminalRecordNotes(db, facilities),
    history: orphanInspectionHistory(db, viewer, facilities),
  }
})
