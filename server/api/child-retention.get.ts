import type { ChildRetentionDto } from '../../shared/types/api'
import { getChildRetentionYears } from '../services/appSettings'

export default defineServiceHandler(async (event): Promise<ChildRetentionDto> => {
  await requireProvider(event)
  return { years: getChildRetentionYears(useDb()) }
})
