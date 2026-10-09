import { isManager } from '#shared/domain/roles'
import type { CareTypeDto, GroupDto } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * Group and care type names for the child pages. Only managers may read the group list, so a Mitarbeiter sees
 * "Gruppe <Nr.>" and cannot pick a group (`canPickGroup`); the care types are readable for everybody.
 * `await ready` in the page so the server renders the names too.
 */
export function useChildLookups() {
  const { user } = useUserSession()
  const canPickGroup = computed(() => isManager(user.value?.role))
  const groupsFetch = useFetch<GroupDto[]>('/api/groups', { key: 'groups', default: () => [], immediate: canPickGroup.value })
  const careTypesFetch = useFetch<CareTypeDto[]>('/api/care-types', { key: 'care-types', default: () => [] })
  const groups = computed(() => groupsFetch.data.value ?? [])
  const careTypes = computed(() => careTypesFetch.data.value ?? [])
  const groupName = (id: number | null) => (id === null ? de.children.noGroup : groups.value.find(group => group.id === id)?.name ?? de.children.groupById(id))
  const careTypeName = (id: number | null) => (id === null ? null : careTypes.value.find(type => type.id === id)?.name ?? null)
  return { groups, careTypes, canPickGroup, groupName, careTypeName, ready: Promise.all([groupsFetch, careTypesFetch]) }
}
