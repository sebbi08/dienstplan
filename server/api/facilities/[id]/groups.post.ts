import { groupNameSchema, idParams } from '../../../schemas'
import { assertFacility } from '../../../services/facilities'
import { createGroup } from '../../../services/groups'

export default defineServiceHandler(async (event) => {
  await requireProvider(event)
  const { id } = await getValidatedRouterParams(event, idParams.parse)
  const { name } = await readValidatedBody(event, groupNameSchema.parse)
  const db = useDb()
  assertFacility(db, id)
  return createGroup(db, id, name)
})
