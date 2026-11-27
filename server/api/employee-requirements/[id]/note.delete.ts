import { idParams } from '../../../schemas'
import { clearCriminalRecordNote } from '../../../services/requirements'

/** „Notiz löschen“ of an entry of the Pflichttermin „Erweitertes Führungszeugnis“ (§ 72a Abs. 5 SGB VIII; the day stays). */
export default defineServiceHandler(async (event) => {
  const admin = await requirePermission(event, 'employees.edit')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  clearCriminalRecordNote(useDb(), admin.facilityId, id)
  return { ok: true }
})
