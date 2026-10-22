<script setup lang="ts">
import type { GroupDto } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * Leitung and Träger: the Gruppenart of each group for the Personalschlüssel, only in states that calculate with group
 * types (BW, NI, SL, NW, HB). 'none' stands for "not entered" (the select needs a non-null value).
 */
const NONE = 'none'
const t = de.staffing
const { data: groups, refresh, hasGroups } = useGroups()
const { data: settings } = useStaffingSettings()
const { busy, run } = useBusyAction(refresh)

const types = computed(() => settings.value?.effective.groupTypes ?? [])
function itemsFor(group: GroupDto) {
  const items = [{ label: t.groupTypeNone, value: NONE }, ...types.value.map(type => ({ label: type.label, value: type.key }))]
  // A key the state no longer knows stays visible instead of silently showing "nicht eingetragen".
  if (group.groupType && !types.value.some(type => type.key === group.groupType)) items.push({ label: group.groupType, value: group.groupType })
  return items
}

function choose(group: GroupDto, value: string) {
  const groupType = value === NONE ? null : value
  if (groupType === group.groupType) return
  run(() => $fetch<unknown>(`/api/groups/${group.id}/group-type`, { method: 'PUT', body: { groupType } }), de.common.saved)
}
</script>

<template>
  <section v-if="hasGroups && types.length" class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ t.groupTypesTitle }}</h2>
    <p class="text-xs text-gray-500">{{ t.groupTypesHint }}</p>
    <div v-for="group in groups ?? []" :key="group.id" class="flex flex-wrap items-center gap-2">
      <span class="w-32 truncate text-sm" :title="group.name">{{ group.name }}</span>
      <USelect
        :model-value="group.groupType ?? NONE" :items="itemsFor(group)" class="w-80" :aria-label="t.groupTypeOf(group.name)" :disabled="busy"
        @update:model-value="choose(group, $event as string)"
      />
    </div>
  </section>
</template>
