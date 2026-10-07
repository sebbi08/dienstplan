import { terminalStampSchema } from '../../schemas'
import { terminalStamp } from '../../services/terminal'

export default defineServiceHandler(async (event) => {
  const terminal = await requireTerminal(event)
  const { employeeId, pin, action } = await readValidatedBody(event, terminalStampSchema.parse)
  return terminalStamp(useDb(), terminal.facilityId, employeeId, pin, action)
})
