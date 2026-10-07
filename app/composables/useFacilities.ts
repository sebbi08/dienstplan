import { isManager } from '#shared/domain/roles'
import type { FacilitiesDto } from '#shared/types/api'

/**
 * The facility this page was loaded for (null until known). It is set once and never follows later answers: when the
 * Träger switches facility in another window, this page still names its own facility to the server, which then refuses
 * (see plugins/pageFacility.client.ts).
 */
export function usePageFacility() {
  return useState<number | null>('page-facility', () => null)
}

/**
 * The facilities the signed-in manager may see and the one they work in (shared by key between the header,
 * the settings and the users page). Not fetched for employees and tablets, which have no facility switcher.
 */
export function useFacilities() {
  const { user } = useUserSession()
  const manager = isManager(user.value?.role)
  const facilities = useFetch<FacilitiesDto>('/api/facilities', { key: 'facilities', immediate: manager, watch: false })
  const activeName = computed(() => facilities.data.value?.facilities.find(f => f.id === facilities.data.value?.activeId)?.name ?? null)
  const pageFacility = usePageFacility()
  watch(() => facilities.data.value?.activeId, (activeId) => {
    if (pageFacility.value === null && activeId != null) pageFacility.value = activeId
  }, { immediate: true })
  return { ...facilities, activeName }
}
