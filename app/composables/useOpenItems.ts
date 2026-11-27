import type { MyOpenItemsDto } from '#shared/types/api'
import { openItemLinks, openItemsCount } from '~/utils/openItems'

/**
 * „Offen für dich“: what waits for the signed-in person (their linked employee), as the card on „Mein Dienstplan“ and the
 * button „Offen (n)“ on the plan page show it – one source, so both count the same. Nothing at the tablet and for accounts
 * with neither a linked employee nor the right to confirm Pflichttermin attendance. Loaded again on every page change,
 * like the menu's counts.
 */
export function useOpenItems() {
  const { user } = useUserSession()
  // Also for whoever confirms the attendance of Pflichttermine (Leitung, Träger), with or without a linked employee.
  const { can } = useCan()
  const enabled = computed(() => !!user.value && user.value.role !== 'terminal'
    && (user.value.employeeId != null || (can('employees.edit') && can('calendar.edit'))))
  const { data, refresh } = useFetch<MyOpenItemsDto>('/api/my/open-items', { key: 'my-open-items', watch: false, immediate: enabled.value, server: false })
  const route = useRoute()
  watch(() => route.fullPath, () => {
    if (enabled.value) refresh()
  })
  const links = computed(() => (data.value && enabled.value ? openItemLinks(data.value) : []))
  const count = computed(() => openItemsCount(links.value))
  return { links, count }
}
