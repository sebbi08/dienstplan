import { todayIso } from '../../../shared/domain/dates'
import { listReminders } from '../../services/reminders'

/** The box „Erinnerungen“: documentation, birthdays and leavings of the viewer's children, staff birthdays. */
export default defineServiceHandler(async (event) => {
  const viewer = await requireChildPermission(event, 'children.view')
  return listReminders(useDb(), viewer, todayIso())
})
