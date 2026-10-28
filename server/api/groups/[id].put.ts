import { groupNameSchema, idParams } from '../../schemas'
import { facilityOfGroup, renameGroup } from '../../services/groups'

/** The Träger renames a group of any facility (not only the active one). */
export default defineServiceHandler(async (event) => {
  await requirePermission(event, 'settings.groups', { facility: 'none' })
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { name } = await readValidatedBody(event, groupNameSchema.parse)
  const db = useDb()
  renameGroup(db, facilityOfGroup(db, id), id, name)
  return { ok: true }
})
