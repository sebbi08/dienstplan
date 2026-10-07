import { isManager } from '#shared/domain/roles'
import type { FacilitiesDto } from '#shared/types/api'

/**
 * The facilities the signed-in manager may see and the one they work in (shared by key between the header,
 * the settings and the users page). Not fetched for employees and tablets, which have no facility switcher.
 */
export function useFacilities() {
  const { user } = useUserSession()
  const manager = isManager(user.value?.role)
  const facilities = useFetch<FacilitiesDto>('/api/facilities', { key: 'facilities', immediate: manager, watch: false })
  const activeName = computed(() => facilities.data.value?.facilities.find(f => f.id === facilities.data.value?.activeId)?.name ?? null)
  return { ...facilities, activeName }
}
