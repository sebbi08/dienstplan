import { terminalStampSchema } from '../../schemas'
import { terminalStamp } from '../../services/terminal'

export default defineServiceHandler(async (event) => {
  await requireTerminal(event)
  const { employeeId, pin, action } = await readValidatedBody(event, terminalStampSchema.parse)
  return terminalStamp(useDb(), employeeId, pin, action)
})
