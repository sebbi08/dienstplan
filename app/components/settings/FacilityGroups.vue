<script setup lang="ts">
import type { GroupDto } from '#shared/types/api'
import { de } from '~/locales/de'

/** Träger only: the groups of one facility, with add, rename and delete (the delete dialog names what goes with it). */
const props = defineProps<{ facilityId: number }>()

// Awaited, so the drafts below are filled before the page is rendered on the server.
const { data: groups, refresh } = await useFetch<GroupDto[]>(() => `/api/facilities/${props.facilityId}/groups`, { default: () => [] })
const { refresh: refreshActive } = useGroups()
// The active facility's groups (rules, templates, employees) follow at once.
const run = useAction(() => Promise.all([refresh(), refreshActive()]))
const confirm = useConfirm()

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
  if (await confirm(de.groups.deleteConfirm(group.name))) {
    run(() => $fetch<unknown>(`/api/groups/${group.id}`, { method: 'DELETE' }), de.common.deleted)
  }
}
</script>

<template>
  <div class="space-y-2 border-l-2 border-gray-100 pl-3">
    <h3 class="text-sm font-semibold text-gray-700">{{ de.groups.title }}</h3>
    <p v-if="!groups?.length" class="text-xs text-gray-500">{{ de.groups.none }}</p>
    <form v-for="group in groups ?? []" :key="group.id" class="flex flex-wrap items-center gap-2" @submit.prevent="rename(group.id)">
      <UInput v-model="names[group.id]" maxlength="80" required size="sm" :aria-label="de.groups.name" />
      <UButton type="submit" size="sm" color="neutral" variant="outline" :label="de.groups.rename" />
      <UButton size="sm" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" @click="remove(group)" />
    </form>
    <form class="flex flex-wrap items-center gap-2" @submit.prevent="create">
      <UInput v-model="newName" maxlength="80" required size="sm" :placeholder="de.groups.name" :aria-label="de.groups.name" />
      <UButton type="submit" size="sm" icon="i-lucide-plus" :label="de.groups.add" />
    </form>
  </div>
</template>
