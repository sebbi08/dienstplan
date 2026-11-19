import { idParams } from '../../../../schemas'
import { ifsgNotice } from '../../../../services/ifsg'

/** The parents' notice („Aushang“) of a case, without names (Leitung and Träger). */
export default defineServiceHandler(async (event) => {
  const manager = await requireChildPermission(event, 'children.manage')
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  return ifsgNotice(useDb(), manager, id)
})
