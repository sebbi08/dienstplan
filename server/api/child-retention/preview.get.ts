import { todayIso } from '../../../shared/domain/dates'
import type { ChildRetentionPreviewDto } from '../../../shared/types/api'
import { childRetentionPreviewQuery } from '../../schemas'
import { countChildrenToPurge } from '../../services/children'

export default defineServiceHandler(async (event): Promise<ChildRetentionPreviewDto> => {
  await requireProvider(event)
  const { years } = await getValidatedQuery(event, childRetentionPreviewQuery.parse)
  return { count: countChildrenToPurge(useDb(), years, todayIso()) }
})
