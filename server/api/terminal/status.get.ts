import { terminalStatus } from '../../services/terminal'

export default defineServiceHandler(async (event) => {
  const terminal = await requireTerminal(event)
  return terminalStatus(useDb(), terminal.facilityId)
})
