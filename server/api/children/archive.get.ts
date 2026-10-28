import { todayIso } from '../../../shared/domain/dates'
import { listArchive } from '../../services/children'

export default defineServiceHandler(async (event) => {
  const manager = await requireChildPermission(event, 'children.manage')
  return listArchive(useDb(), manager.facilityId, todayIso())
})
