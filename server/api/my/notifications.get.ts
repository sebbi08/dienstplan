import { listNotifications } from '../../services/notifications'

export default defineServiceHandler(async (event) => {
  const user = await requireUser(event)
  // Accounts without an employee (e.g. a Träger who does not work in the plan) simply have no messages.
  return user.employeeId === null ? [] : listNotifications(useDb(), user.employeeId)
})
