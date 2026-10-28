<script setup lang="ts">
import { de } from '~/locales/de'

/**
 * Leitung and Träger, on the group's page: its Gruppenart for the Personalschlüssel, only in states that calculate with
 * group types (BW, NI, SL, NW, HB). 'none' stands for "not entered" (the select needs a non-null value); a choice saves it.
 */
const props = defineProps<{ groupId: number }>()
const NONE = 'none'
const t = de.staffing
const { data: groups, refresh } = useGroups()
const { data: settings } = useStaffingSettings()
const { busy, run } = useBusyAction(refresh)

const group = computed(() => groups.value?.find(candidate => candidate.id === props.groupId) ?? null)
const types = computed(() => settings.value?.effective.groupTypes ?? [])
const items = computed(() => {
  const list = [{ label: t.groupTypeNone, value: NONE }, ...types.value.map(type => ({ label: type.label, value: type.key }))]
  // A key the state no longer knows stays visible instead of silently showing "nicht eingetragen".
  const current = group.value?.groupType
  if (current && !types.value.some(type => type.key === current)) list.push({ label: current, value: current })
  return list
})

/** The chosen type's explanation under the select; the ⓘ explains all types of the state (to compare before choosing). */
const currentHint = computed(() => types.value.find(type => type.key === group.value?.groupType)?.description ?? null)
const allHints = computed(() => types.value.filter(type => type.description)
  .map(type => `${type.label}: ${type.description}`).join('\n\n') || null)

function choose(value: string) {
  const current = group.value
  const groupType = value === NONE ? null : value
  if (!current || groupType === current.groupType) return
  run(() => $fetch<unknown>(`/api/groups/${current.id}/group-type`, { method: 'PUT', body: { groupType } }), de.common.saved)
}
</script>

<template>
  <section v-if="group && types.length" class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ t.groupTypesTitle }}</h2>
    <p class="text-xs text-gray-500">{{ t.groupTypesHint }}</p>
    <div class="flex items-center gap-2">
      <USelect
        :model-value="group.groupType ?? NONE" :items="items" class="w-full max-w-80" :aria-label="t.groupTypeOf(group.name)" :disabled="busy"
        @update:model-value="choose($event as string)"
      />
      <InfoHint v-if="allHints" :text="allHints" />
    </div>
    <p v-if="currentHint" class="text-xs text-gray-600">{{ currentHint }}</p>
  </section>
</template>
