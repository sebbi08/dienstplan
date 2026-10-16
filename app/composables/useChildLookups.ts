import type { CareTypeDto, ChildGroupDto } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * Group and care type names and the staff (for the Bezugserzieher) for the child pages, readable for everyone who may see child records. Whoever may edit
 * child records can also pick a group and care type (`canPickGroup`). `await ready` in the page so the server renders
 * the names too.
 */
export function useChildLookups() {
  // At the tablet the person who unlocked it decides.
  const { rights } = useChildRights()
  const canPickGroup = computed(() => !!rights.value?.canEdit)
  // Only the groups the viewer sees, each with its right ('write' = own, 'read' = granted).
  const groupsFetch = useFetch<ChildGroupDto[]>('/api/children/groups', { key: 'child-groups', default: () => [] })
  const careTypesFetch = useFetch<CareTypeDto[]>('/api/care-types', { key: 'care-types', default: () => [] })
  const staffFetch = useFetch<{ id: number; name: string }[]>('/api/children/staff', { key: 'child-staff', default: () => [] })
  const groups = computed(() => groupsFetch.data.value ?? [])
  const careTypes = computed(() => careTypesFetch.data.value ?? [])
  const staff = computed(() => staffFetch.data.value ?? [])
  const groupName = (id: number | null) => (id === null ? de.children.noGroup : groups.value.find(group => group.id === id)?.name ?? de.children.groupById(id))
  const careTypeName = (id: number | null) => (id === null ? null : careTypes.value.find(type => type.id === id)?.name ?? null)
  return { groups, careTypes, staff, canPickGroup, groupName, careTypeName, ready: Promise.all([groupsFetch, careTypesFetch, staffFetch]) }
}
