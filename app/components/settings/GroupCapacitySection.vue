<script setup lang="ts">
import { de } from '~/locales/de'

/**
 * Leitung and Träger, on the group's page: its Höchstzahl Kinder (the same number as „Plätze“ in the Belegung; empty =
 * none), and the facility's own maximum, which only the Träger sets (under Einrichtung → Einrichtungen).
 */
const props = defineProps<{ groupId: number }>()
const { data: groups, refresh } = useGroups()
const { data: facilities } = useFacilities()
// The facility the settings show (the Träger may have chosen another one than the active facility).
const settingsFacilityId = useSettingsFacilityId()
// The places are shown in the Belegung and the child pages' group list too.
const { busy, run } = useBusyAction(() => Promise.all([refresh(), refreshNuxtData(['child-groups', 'children-occupancy'])]))

const group = computed(() => groups.value?.find(candidate => candidate.id === props.groupId) ?? null)
const facilityCapacity = computed(() => {
  return facilities.value?.facilities.find(facility => facility.id === settingsFacilityId.value)?.capacity ?? null
})

const storedText = computed(() => (group.value?.capacity == null ? '' : String(group.value.capacity)))
// The draft follows the stored number while it is not edited (a refresh keeps an unsaved edit).
const draft = ref(storedText.value)
watch(storedText, (next, previous) => {
  if (String(draft.value ?? '').trim() === previous) draft.value = next
})
const dirty = useDirty(() => !!group.value && String(draft.value ?? '').trim() !== storedText.value)

async function save() {
  const current = group.value
  if (!current || !dirty.value) return
  const text = String(draft.value ?? '').trim()
  const body = { capacity: text === '' ? null : Number(text) }
  if (await run(() => $fetch<unknown>(`/api/groups/${current.id}/capacity`, { method: 'PUT', body }), de.common.saved)) draft.value = storedText.value
}
</script>

<template>
  <section v-if="group" class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ de.capacity.groupLabel }}</h2>
    <p class="text-xs text-gray-500">{{ de.capacity.groupsHint }}</p>
    <form class="flex flex-wrap items-center gap-2" @submit.prevent="save">
      <UInput
        v-model="draft" type="number" min="1" max="200" step="1" size="sm" class="w-24"
        :aria-label="de.capacity.groupLabelOf(group.name)" :placeholder="de.capacity.groupLabel"
      />
      <UButton type="submit" size="sm" color="neutral" variant="outline" :label="de.common.save" :disabled="busy || !dirty" />
    </form>
    <p class="text-xs text-gray-500">
      {{ facilityCapacity === null ? de.capacity.facilityNone : de.capacity.facilityShown(facilityCapacity) }}
    </p>
  </section>
</template>
