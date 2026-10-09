import { mayEditChildren } from '#shared/domain/roles'
import type { CareTypeDto, GroupDto } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * Group and care type names for the child pages, readable for everyone who may see child records. Whoever may edit
 * child records can also pick a group and care type (`canPickGroup`). `await ready` in the page so the server renders
 * the names too.
 */
export function useChildLookups() {
  const { user } = useUserSession()
  const canPickGroup = computed(() => !!user.value && mayEditChildren(user.value))
  const groupsFetch = useFetch<GroupDto[]>('/api/children/groups', { key: 'child-groups', default: () => [] })
  const careTypesFetch = useFetch<CareTypeDto[]>('/api/care-types', { key: 'care-types', default: () => [] })
  const groups = computed(() => groupsFetch.data.value ?? [])
  const careTypes = computed(() => careTypesFetch.data.value ?? [])
  const groupName = (id: number | null) => (id === null ? de.children.noGroup : groups.value.find(group => group.id === id)?.name ?? de.children.groupById(id))
  const careTypeName = (id: number | null) => (id === null ? null : careTypes.value.find(type => type.id === id)?.name ?? null)
  return { groups, careTypes, canPickGroup, groupName, careTypeName, ready: Promise.all([groupsFetch, careTypesFetch]) }
}
