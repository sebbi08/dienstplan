import { cashPurposeQuery } from '../../schemas'
import { purposeSuggestions } from '../../services/cashEntries'

/** Suggestions for the purpose (Verwendungszweck): the facility's most used texts containing `q`, at most 8. */
export default defineServiceHandler(async (event) => {
  const admin = await requireAdmin(event)
  const { q } = await getValidatedQuery(event, cashPurposeQuery.parse)
  return purposeSuggestions(useDb(), admin.facilityId, q)
})
