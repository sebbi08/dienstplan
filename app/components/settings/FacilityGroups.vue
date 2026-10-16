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
const { refresh: refreshActive } = useGroups()
// The active facility's groups (rules, templates, employees) follow at once, and the switch of the automatic leaving
// (settings section) follows a flag or a deleted group, and the opening hours list the groups too.
const { busy, run } = useBusyAction(() => Promise.all([refresh(), refreshActive(), refreshNuxtData('school-settings'), refreshNuxtData('opening-hours')]))
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
</script>

<template>
  <div class="space-y-2 border-l-2 border-gray-100 pl-3">
    <h3 class="text-sm font-semibold text-gray-700">{{ de.groups.title }}</h3>
    <p v-if="!groups?.length" class="text-xs text-gray-500">{{ de.groups.none }}</p>
    <form v-for="group in groups ?? []" :key="group.id" class="flex flex-wrap items-center gap-2" @submit.prevent="rename(group.id)">
      <UInput v-model="names[group.id]" maxlength="80" required size="sm" :aria-label="de.groups.name" />
      <UButton type="submit" size="sm" color="neutral" variant="outline" :label="de.groups.rename" :disabled="busy" />
      <UCheckbox
        :model-value="group.forSchoolChildren" :label="de.schoolChildren.forSchoolChildren" :aria-label="`${de.schoolChildren.forSchoolChildren}: ${group.name}`" :disabled="busy"
        @update:model-value="setForSchoolChildren(group, $event === true)"
      />
      <UButton size="sm" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" :disabled="busy" @click="remove(group)" />
    </form>
    <p v-if="groups?.length" class="text-xs text-gray-500">{{ de.schoolChildren.forSchoolChildrenHint }}</p>
    <SettingsGroupReadAccess v-if="(groups?.length ?? 0) > 1" :groups="groups ?? []" :source="`/api/facilities/${facilityId}/group-read-access`" />
    <form class="flex flex-wrap items-center gap-2" @submit.prevent="create">
      <UInput v-model="newName" maxlength="80" required size="sm" :placeholder="de.groups.name" :aria-label="de.groups.name" />
      <UButton type="submit" size="sm" icon="i-lucide-plus" :label="de.groups.add" :disabled="busy" />
    </form>
  </div>
</template>
