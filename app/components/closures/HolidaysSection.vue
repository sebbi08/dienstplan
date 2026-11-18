<script setup lang="ts">
import { weekday } from '#shared/domain/dates'
import { holidaysOf } from '#shared/domain/holidays'
import { de } from '~/locales/de'
import { formatDayShort } from '~/utils/format'
import { inState } from '~/utils/states'

/** Public holidays of the active facility's state for the year chosen on the closures page (computed, read-only). */
const props = defineProps<{ year: number }>()
const { data: facilities } = useFacilities()
const facility = computed(() => facilities.value?.facilities.find(candidate => candidate.id === facilities.value?.activeId))
const holidays = computed(() => facility.value
  ? [...holidaysOf({ state: facility.value.state, assumptionDay: facility.value.assumptionDay }, props.year)].sort(([a], [b]) => a.localeCompare(b))
  : [])
</script>

<template>
  <section v-if="facility" class="space-y-3">
    <h2 class="text-xl font-semibold">{{ de.closures.holidaysTitle(inState(facility.state)) }} {{ year }}</h2>
    <p class="text-sm text-gray-500">{{ de.closures.holidaysHint }}</p>
    <table class="w-full overflow-hidden rounded-lg bg-white text-sm ring-1 ring-gray-200">
      <thead class="bg-gray-100 text-left text-xs text-gray-600">
        <tr><th class="w-40 px-3 py-2">{{ de.closures.holidayDate }}</th><th class="px-3 py-2">{{ de.closures.holidayName }}</th></tr>
      </thead>
      <tbody>
        <tr v-for="[date, key] in holidays" :key="date" class="border-t border-gray-100">
          <td class="whitespace-nowrap px-3 py-2">{{ formatDayShort(date, weekday(date)) }}{{ year }}</td>
          <td class="px-3 py-2">{{ de.holidays[key] }}</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>
