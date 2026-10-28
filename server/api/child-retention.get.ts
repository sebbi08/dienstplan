import type { ChildRetentionDto } from '../../shared/types/api'
import { getChildRetentionYears } from '../services/appSettings'

export default defineServiceHandler(async (event): Promise<ChildRetentionDto> => {
  await requirePermission(event, 'settings.retention', { facility: 'none' })
  return { years: getChildRetentionYears(useDb()) }
})
