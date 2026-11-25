import { todayIso } from '../../../shared/domain/dates'
import type { MyOpenItemsDto } from '../../../shared/types/api'
import { myOpenItems } from '../../services/openItems'

/** „Offen für dich“: what waits for the account's own linked employee (all zero without one). Never another person's items. */
export default defineServiceHandler(async (event): Promise<MyOpenItemsDto> => {
  const user = await requireUser(event)
  return myOpenItems(useDb(), await withHomeGroup(event, user), todayIso())
})
