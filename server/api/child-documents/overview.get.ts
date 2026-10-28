import { todayIso } from '../../../shared/domain/dates'
import { documentOverview } from '../../services/childDocuments'

export default defineServiceHandler(async (event) => {
  const viewer = await requireChildPermission(event, 'children.view')
  return documentOverview(useDb(), viewer, viewer.facilityId, todayIso())
})
