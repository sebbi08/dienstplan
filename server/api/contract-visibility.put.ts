import { contractVisibilitySchema } from '../schemas'
import { setContractVisibleToAdmins } from '../services/appSettings'

export default defineServiceHandler(async (event) => {
  await requirePermission(event, 'rights.manage', { facility: 'none' })
  const { visible } = await readValidatedBody(event, contractVisibilitySchema.parse)
  setContractVisibleToAdmins(useDb(), visible)
  return { ok: true }
})
