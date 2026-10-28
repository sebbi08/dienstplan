import { rightsRoleParams, roleRightsSchema } from '../../../schemas'
import { rightsRole, saveRoleRights } from '../../../services/rights'

/** Sets the switches of Leitung or Mitarbeiter (Träger only); applies to every account of the role from its next request. */
export default defineServiceHandler(async (event) => {
  await requirePermission(event, 'rights.manage', { facility: 'none' })
  const { role } = await getValidatedRouterParams(event, rightsRoleParams.parse)
  const { bundles } = await readValidatedBody(event, roleRightsSchema.parse)
  return saveRoleRights(useDb(), rightsRole(role), bundles)
})
