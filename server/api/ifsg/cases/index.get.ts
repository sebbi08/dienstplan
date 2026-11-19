import { yearQuery } from '../../../schemas'
import { listIfsgCases } from '../../../services/ifsg'

/** „§ 34 IfSG“: the facility's cases entered in the year, with the child's name (Leitung and Träger). */
export default defineServiceHandler(async (event) => {
  const manager = await requireChildPermission(event, 'children.manage')
  const { year } = await getValidatedQuery(event, yearQuery.parse)
  return listIfsgCases(useDb(), manager, year)
})
