<script setup lang="ts">
import type { OpeningHoursDto } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * Leitung and Träger, on the group's page: how much staff the state's rules demand for the group at full occupancy and
 * now. It follows the group type, the places and the opening hours: their sections refresh the shared estimate after a
 * change, and a changed type or number of places (in this or another window's refresh) fetches it again here as well.
 */
const props = defineProps<{ groupId: number }>()
const t = de.staffing
const { data: groups } = useGroups()
const { data, refresh } = useStaffingEstimate()

const group = computed(() => groups.value?.find(candidate => candidate.id === props.groupId) ?? null)
const estimate = computed(() => data.value?.groups.find(entry => entry.groupId === props.groupId) ?? null)
watch([() => group.value?.groupType, () => group.value?.capacity, () => group.value?.forSchoolChildren], () => refresh())
// Saved opening hours (the section on this page refreshes them): the average opening changed. Not on the first load.
const { data: openingHours } = useNuxtData<OpeningHoursDto>('opening-hours')
watch(openingHours, (_next, previous) => {
  if (previous) refresh()
})
</script>

<template>
  <section v-if="data && estimate" class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ t.estimate.sectionTitle }}</h2>
    <SettingsStaffingEstimate :estimate="estimate" :land="data.land" :fte-hours-per-week="data.fteHoursPerWeek" />
    <p class="text-xs text-gray-500">{{ t.disclaimer }}</p>
  </section>
</template>
