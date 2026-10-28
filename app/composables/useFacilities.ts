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
 * The facility whose settings the Träger edits on the settings pages when it is not the active one (null: the active
 * one). Kept while moving between the settings pages and dropped on leaving them (see plugins/pageFacility.client.ts);
 * the header and every other page stay on the active facility.
 */
export function useSettingsFacility() {
  return useState<number | null>('settings-facility', () => null)
}

/** The facility the settings pages show: the one the Träger chose there, otherwise the active one. */
export function useSettingsFacilityId() {
  const chosen = useSettingsFacility()
  const { data } = useFacilities()
  return computed(() => chosen.value ?? data.value?.activeId ?? null)
}

/**
 * The facilities the signed-in account may see (the own one; the Träger all of them) and the one they work in (shared
 * by key between the header, the settings and the users page). Not fetched for the tablet, which has no header name.
 */
export function useFacilities() {
  const { user } = useUserSession()
  // GET /api/facilities answers every signed-in account but the tablet.
  const signedIn = !!user.value && user.value.role !== 'terminal'
  const facilities = useFetch<FacilitiesDto>('/api/facilities', { key: 'facilities', immediate: signedIn, watch: false })
  const activeName = computed(() => facilities.data.value?.facilities.find(f => f.id === facilities.data.value?.activeId)?.name ?? null)
  const pageFacility = usePageFacility()
  watch(() => facilities.data.value?.activeId, (activeId) => {
    if (pageFacility.value === null && activeId != null) pageFacility.value = activeId
  }, { immediate: true })
  return { ...facilities, activeName }
}
