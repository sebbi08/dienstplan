<script setup lang="ts">
import type { GroupDto } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * Träger only: the groups of one facility, with add, rename and delete (the delete dialog names what goes with it), and
 * per group the other groups its staff may also read at the tablet.
 */
const props = defineProps<{ facilityId: number }>()

// Awaited, so the drafts below are filled before the page is rendered on the server.
const { data: groups, refresh } = await useFetch<GroupDto[]>(() => `/api/facilities/${props.facilityId}/groups`, { default: () => [] })
// Per group the ids of the groups it may also read. On the server this forwards the session cookie.
const requestFetch = useRequestFetch()
const { data: readAccess, refresh: refreshReadAccess } = await useAsyncData(
  () => `group-read-access-${props.facilityId}`,
  async (): Promise<Record<number, number[]>> => Object.fromEntries(await Promise.all((groups.value ?? []).map(async group =>
    [group.id, (await requestFetch<{ readable: number[] }>(`/api/groups/${group.id}/read-access`)).readable] as const))),
  { default: (): Record<number, number[]> => ({}) },
)
const { refresh: refreshActive } = useGroups()
// The active facility's groups (rules, templates, employees) follow at once, and the switch of the automatic leaving
// (settings section) follows a flag or a deleted group. The read access follows the groups (a new or deleted one).
const { busy, run } = useBusyAction(async () => {
  await Promise.all([refresh(), refreshActive(), refreshNuxtData('school-settings')])
  await refreshReadAccess()
})
const confirm = useConfirm()
const notifySwitchedOff = useAutoLeaveNotice()

// One draft per group; a refresh keeps drafts with an unsaved edit (as for the facility names).
const names = reactive<Record<number, string>>({})
const stored = new Map<number, string>()
function syncNames(saved?: number) {
  for (const group of groups.value ?? []) {
    const untouched = names[group.id] === undefined || names[group.id] === stored.get(group.id)
    if (untouched || group.id === saved) names[group.id] = group.name
    stored.set(group.id, group.name)
  }
}
watch(groups, () => syncNames(), { immediate: true })
const newName = ref('')

async function rename(id: number) {
  if (await run(() => $fetch<unknown>(`/api/groups/${id}`, { method: 'PUT', body: { name: names[id] } }), de.common.saved)) syncNames(id)
}

async function create() {
  if (await run(() => $fetch<unknown>(`/api/facilities/${props.facilityId}/groups`, { method: 'POST', body: { name: newName.value } }),
    de.common.saved)) newName.value = ''
}

async function remove(group: GroupDto) {
  if (!await confirm(de.groups.deleteConfirm(group.name))) return
  const answer = { autoLeaveSwitchedOff: false }
  const ok = await run(async () => {
    answer.autoLeaveSwitchedOff = (await $fetch<{ ok: boolean; autoLeaveSwitchedOff: boolean }>(`/api/groups/${group.id}`, { method: 'DELETE' })).autoLeaveSwitchedOff
  }, de.common.deleted)
  if (ok && answer.autoLeaveSwitchedOff) notifySwitchedOff()
}

/** Flags the group as being for school children or takes the flag away (which switches the facility's automatic leaving off). */
async function setForSchoolChildren(group: GroupDto, value: boolean) {
  const answer = { autoLeaveSwitchedOff: false }
  const ok = await run(async () => {
    answer.autoLeaveSwitchedOff = (await $fetch<{ ok: boolean; autoLeaveSwitchedOff: boolean }>(`/api/groups/${group.id}/school-children`, { method: 'PUT', body: { forSchoolChildren: value } })).autoLeaveSwitchedOff
  }, de.common.saved)
  if (ok && answer.autoLeaveSwitchedOff) notifySwitchedOff()
}

const otherGroups = (group: GroupDto) => (groups.value ?? []).filter(other => other.id !== group.id)
const mayRead = (group: GroupDto, other: GroupDto) => readAccess.value[group.id]?.includes(other.id) ?? false

/** Lets the staff of the group also read the other group (one direction), or takes that away. */
async function setMayRead(group: GroupDto, other: GroupDto, value: boolean) {
  const current = readAccess.value[group.id] ?? []
  const readable = value ? [...current, other.id] : current.filter(id => id !== other.id)
  await run(() => $fetch<unknown>(`/api/groups/${group.id}/read-access`, { method: 'PUT', body: { readable } }), de.common.saved)
}
</script>

<template>
  <div class="space-y-2 border-l-2 border-gray-100 pl-3">
    <h3 class="text-sm font-semibold text-gray-700">{{ de.groups.title }}</h3>
    <p v-if="!groups?.length" class="text-xs text-gray-500">{{ de.groups.none }}</p>
    <div v-for="group in groups ?? []" :key="group.id" class="space-y-1">
      <form class="flex flex-wrap items-center gap-2" @submit.prevent="rename(group.id)">
        <UInput v-model="names[group.id]" maxlength="80" required size="sm" :aria-label="de.groups.name" />
        <UButton type="submit" size="sm" color="neutral" variant="outline" :label="de.groups.rename" :disabled="busy" />
        <UCheckbox
          :model-value="group.forSchoolChildren" :label="de.schoolChildren.forSchoolChildren" :aria-label="`${de.schoolChildren.forSchoolChildren}: ${group.name}`" :disabled="busy"
          @update:model-value="setForSchoolChildren(group, $event === true)"
        />
        <UButton size="sm" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" :disabled="busy" @click="remove(group)" />
      </form>
      <div v-if="otherGroups(group).length" class="flex flex-wrap items-center gap-x-3 gap-y-1 pl-1">
        <span class="text-xs text-gray-600">{{ de.groups.mayAlsoRead }}</span>
        <UCheckbox
          v-for="other in otherGroups(group)" :key="other.id" size="sm" :model-value="mayRead(group, other)" :label="other.name"
          :aria-label="de.groups.mayAlsoReadLabel(group.name, other.name)" :disabled="busy"
          @update:model-value="setMayRead(group, other, $event === true)"
        />
      </div>
    </div>
    <p v-if="groups?.length" class="text-xs text-gray-500">{{ de.schoolChildren.forSchoolChildrenHint }}</p>
    <p v-if="(groups?.length ?? 0) > 1" class="text-xs text-gray-500">{{ de.groups.readOnlyHint }}</p>
    <form class="flex flex-wrap items-center gap-2" @submit.prevent="create">
      <UInput v-model="newName" maxlength="80" required size="sm" :placeholder="de.groups.name" :aria-label="de.groups.name" />
      <UButton type="submit" size="sm" icon="i-lucide-plus" :label="de.groups.add" :disabled="busy" />
    </form>
  </div>
</template>
