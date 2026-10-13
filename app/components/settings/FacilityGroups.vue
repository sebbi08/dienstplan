<script setup lang="ts">
import type { GroupDto, SchoolSettingsDto } from '#shared/types/api'
import { de } from '~/locales/de'

/** Träger only: the groups of one facility, with add, rename and delete (the delete dialog names what goes with it). */
const props = defineProps<{ facilityId: number }>()

// Awaited, so the drafts below are filled before the page is rendered on the server.
const { data: groups, refresh } = await useFetch<GroupDto[]>(() => `/api/facilities/${props.facilityId}/groups`, { default: () => [] })
const { refresh: refreshActive } = useGroups()
// The active facility's groups (rules, templates, employees) follow at once.
// The switch of the automatic leaving (settings section) follows a flag or a deleted group.
const { busy, run } = useBusyAction(() => Promise.all([refresh(), refreshActive(), refreshNuxtData('school-settings')]))
const confirm = useConfirm()
const notifySwitchedOff = useAutoLeaveNotice()
const { data: facilitiesData } = useFacilities()
const { data: schoolSettings } = useNuxtData<SchoolSettingsDto>('school-settings')

/**
 * Whether the facility's automatic leaving may have been on before a flagged group lost its flag or was deleted. The
 * answer of the server only names the switch afterwards. The settings section knows it for the active facility; for
 * another facility the notice is shown to be safe.
 */
const switchMayHaveBeenOn = () => facilitiesData.value?.activeId !== props.facilityId || schoolSettings.value?.autoLeave !== false

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
  const mayBeOn = switchMayHaveBeenOn()
  const answer = { autoLeave: true }
  const ok = await run(async () => {
    answer.autoLeave = (await $fetch<{ ok: boolean; autoLeave: boolean }>(`/api/groups/${group.id}`, { method: 'DELETE' })).autoLeave
  }, de.common.deleted)
  if (ok && group.forSchoolChildren && !answer.autoLeave && mayBeOn) notifySwitchedOff()
}

/** Flags the group as being for school children or takes the flag away (which switches the facility's automatic leaving off). */
async function setForSchoolChildren(group: GroupDto, value: boolean) {
  const mayBeOn = switchMayHaveBeenOn()
  const answer = { autoLeave: true }
  const ok = await run(async () => {
    answer.autoLeave = (await $fetch<{ ok: boolean; autoLeave: boolean }>(`/api/groups/${group.id}/school-children`, { method: 'PUT', body: { forSchoolChildren: value } })).autoLeave
  }, de.common.saved)
  if (ok && !value && group.forSchoolChildren && !answer.autoLeave && mayBeOn) notifySwitchedOff()
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
        :model-value="group.forSchoolChildren" :label="de.schoolChildren.forSchoolChildren" :disabled="busy"
        @update:model-value="setForSchoolChildren(group, $event === true)"
      />
      <UButton size="sm" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" :disabled="busy" @click="remove(group)" />
    </form>
    <p v-if="groups?.length" class="text-xs text-gray-500">{{ de.schoolChildren.forSchoolChildrenHint }}</p>
    <form class="flex flex-wrap items-center gap-2" @submit.prevent="create">
      <UInput v-model="newName" maxlength="80" required size="sm" :placeholder="de.groups.name" :aria-label="de.groups.name" />
      <UButton type="submit" size="sm" icon="i-lucide-plus" :label="de.groups.add" :disabled="busy" />
    </form>
  </div>
</template>
