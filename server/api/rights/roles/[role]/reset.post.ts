import { rightsRoleParams } from '../../../../schemas'
import { resetRoleRights, rightsRole } from '../../../../services/rights'

/** Puts the role back to the Grundeinstellung (Träger only). */
export default defineServiceHandler(async (event) => {
  await requirePermission(event, 'rights.manage', { facility: 'none' })
  const { role } = await getValidatedRouterParams(event, rightsRoleParams.parse)
  return resetRoleRights(useDb(), rightsRole(role))
})
