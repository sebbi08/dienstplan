import { groupNameSchema, idParams } from '../../schemas'
import { facilityOfGroupInReach, renameGroup } from '../../services/groups'

/** Renames a group: the Träger of any facility (not only the active one), everyone else only of their own (else 404). */
export default defineServiceHandler(async (event) => {
  const user = await requirePermission(event, 'settings.groups', { facility: 'none' })
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { name } = await readValidatedBody(event, groupNameSchema.parse)
  const db = useDb()
  renameGroup(db, facilityOfGroupInReach(db, user, id), id, name)
  return { ok: true }
})
