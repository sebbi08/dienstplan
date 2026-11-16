import type { StaffingEstimatePreviewDto } from '../../../../shared/types/api'
import { staffingEstimatePreviewQuery } from '../../../schemas'
import { staffingEstimatePreview } from '../../../services/staffingEstimate'

/** The live estimate of a group while it is created or edited (type and places not saved yet), and the facility with it. */
export default defineServiceHandler(async (event): Promise<StaffingEstimatePreviewDto> => {
  const admin = await requirePermission(event, 'settings.facility')
  const query = await getValidatedQuery(event, staffingEstimatePreviewQuery.parse)
  return staffingEstimatePreview(useDb(), admin.facilityId, query)
})
