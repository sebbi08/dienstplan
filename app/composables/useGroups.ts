import type { GroupDto } from '#shared/types/api'

/**
 * The groups of the facility the manager works in, shared by key between the settings, the employee pages and the
 * Träger's group list (which refreshes it after a change). Empty when the facility has no groups.
 */
export function useGroups() {
  const groups = useFetch<GroupDto[]>('/api/groups', { key: 'groups', default: () => [] })
  const hasGroups = computed(() => (groups.data.value?.length ?? 0) > 0)
  return { ...groups, hasGroups }
}
