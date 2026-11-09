import { nowInBerlin } from '../../../shared/domain/timeRecords'
import { notesQuery } from '../../schemas'
import { listNotes } from '../../services/facilityNotes'

/**
 * The notes of the active facility (current and expired, filtered by group and search `q`) with the groups and what
 * the reader may write: every person of the facility and the facility's tablet (no key of its own).
 */
export default defineServiceHandler(async (event) => {
  const user = await requirePermission(event, 'notes.view', { allowTerminal: true, facility: 'active' })
  const { group, q } = await getValidatedQuery(event, notesQuery.parse)
  return listNotes(useDb(), user, { group, q }, nowInBerlin(new Date()).date)
})
