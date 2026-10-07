import type { NotificationDto } from '#shared/types/api'

/**
 * The signed-in employee's messages about changed duties, shared by the menu badge and "Mein Dienstplan".
 * Accounts without an employee get an empty list from the server.
 */
export function useMyNotifications() {
  const { user } = useUserSession()
  const enabled = computed(() => !!user.value && user.value.role !== 'terminal' && user.value.employeeId !== null)
  const { data, refresh } = useFetch<NotificationDto[]>('/api/my/notifications', {
    key: 'my-notifications', immediate: enabled.value, default: () => [], watch: false,
  })
  const unread = computed(() => (enabled.value ? (data.value ?? []).filter(message => message.readAt === null) : []))

  async function markRead(ids: number[]) {
    if (ids.length === 0) return
    await $fetch<unknown>('/api/my/notifications/read', { method: 'POST', body: { ids } })
    await refresh()
  }
  return { messages: data, unread, refresh, markRead, enabled }
}
