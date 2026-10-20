<script setup lang="ts">
import { de } from '~/locales/de'

/**
 * Leitung and Träger: the Höchstzahl Kinder of each group of the active facility (the same number as „Plätze“ in the
 * Belegung; empty = none), and the facility's own maximum, which only the Träger sets (under Einrichtungen).
 */
const { data: groups, refresh, hasGroups } = useGroups()
const { data: facilities } = useFacilities()
// The places are shown in the Belegung and the child pages' group list too.
const { busy, run } = useBusyAction(() => Promise.all([refresh(), refreshNuxtData(['child-groups', 'children-occupancy'])]))

const facilityCapacity = computed(() => {
  const list = facilities.value
  return list?.facilities.find(facility => facility.id === list.activeId)?.capacity ?? null
})

// One draft per group; a refresh keeps a draft with an unsaved edit.
const drafts = reactive<Record<number, string>>({})
const stored = new Map<number, string>()
function syncDrafts(saved?: number) {
  for (const group of groups.value ?? []) {
    const text = group.capacity === null ? '' : String(group.capacity)
    if (drafts[group.id] === undefined || drafts[group.id] === stored.get(group.id) || group.id === saved) drafts[group.id] = text
    stored.set(group.id, text)
  }
}
watch(groups, () => syncDrafts(), { immediate: true })

async function save(id: number) {
  const text = String(drafts[id] ?? '').trim()
  const body = { capacity: text === '' ? null : Number(text) }
  if (await run(() => $fetch<unknown>(`/api/groups/${id}/capacity`, { method: 'PUT', body }), de.common.saved)) syncDrafts(id)
}
</script>

<template>
  <section v-if="hasGroups" class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ de.capacity.groupsTitle }}</h2>
    <p class="text-xs text-gray-500">{{ de.capacity.groupsHint }}</p>
    <div class="flex gap-2 text-xs font-medium text-gray-600" aria-hidden="true">
      <span class="w-32">{{ de.occupancy.group }}</span><span>{{ de.capacity.groupLabel }}</span>
    </div>
    <form v-for="group in groups ?? []" :key="group.id" class="flex flex-wrap items-center gap-2" @submit.prevent="save(group.id)">
      <span class="w-32 truncate text-sm" :title="group.name">{{ group.name }}</span>
      <UInput
        v-model="drafts[group.id]" type="number" min="1" max="200" step="1" size="sm" class="w-24"
        :aria-label="de.capacity.groupLabelOf(group.name)" :placeholder="de.capacity.groupLabel"
      />
      <UButton type="submit" size="sm" color="neutral" variant="outline" :label="de.common.save" :disabled="busy" />
    </form>
    <p class="text-xs text-gray-500">
      {{ facilityCapacity === null ? de.capacity.facilityNone : de.capacity.facilityShown(facilityCapacity) }}
    </p>
  </section>
</template>
