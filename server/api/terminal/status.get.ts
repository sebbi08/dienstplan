import { terminalStatus } from '../../services/terminal'

export default defineServiceHandler(async (event) => {
  await requireTerminal(event)
  return terminalStatus(useDb())
})
