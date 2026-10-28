import { childSchoolCutoff } from '../../services/children'

/** The facility's school cutoff, so the child form shows the computed school start of a child being entered. */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildPermission(event, 'children.view')
  return childSchoolCutoff(useDb(), viewer)
})
