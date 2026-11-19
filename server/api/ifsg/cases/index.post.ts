import { ifsgCaseSchema } from '../../../schemas'
import { createIfsgCase } from '../../../services/ifsgCases'

/** A new § 34 IfSG case of a child, with the day's absence; the service lets the child's own group and the managers. */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildPermission(event, 'children.attendance')
  const body = await readValidatedBody(event, ifsgCaseSchema.parse)
  return { id: createIfsgCase(useDb(), viewer, body) }
})
