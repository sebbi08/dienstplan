<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import type { SickYearRowDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'

/**
 * „Krankheitstage“ in the tab „Gesundheit“ (only with employees.sickness, never on the own page): the person's sick
 * periods of a year from the plan's „Krank“ entries (the same numbers as Mitarbeiter → Krankheitstage), with a link to
 * the whole team's list. Health data: loaded in the browser once the tab is opened; the server checks the right.
 */
const props = defineProps<{ employeeId: number; active: boolean }>()
const t = de.sickDays
const year = ref(parseIsoDate(todayIso()).year)
const { data, error, execute } = useFetch<SickYearRowDto[]>('/api/sick-days', {
  query: { year }, server: false, immediate: false, watch: false,
})
const loaded = ref(false)
onMounted(() => {
  watch(() => props.active, (active) => {
    if (active && !loaded.value) {
      loaded.value = true
      void execute()
    }
  }, { immediate: true })
})
watch(year, () => { if (loaded.value) void execute() })

const row = computed(() => (data.value ?? []).find(entry => entry.employeeId === props.employeeId) ?? null)
const period = (range: { from: string; to: string; days: number }) =>
  `${range.from === range.to ? formatDate(range.from) : `${formatDate(range.from)} – ${formatDate(range.to)}`} · ${t.days(range.days)}`
</script>

<template>
  <section class="space-y-2 rounded-lg bg-white p-4 text-sm ring-1 ring-gray-200">
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
      <h2 class="font-semibold">{{ t.title }}</h2>
      <YearNav v-model="year" />
      <NuxtLink :to="{ path: '/admin/employees/sick-days', query: { year } }" class="text-xs text-sky-700 hover:underline sm:ml-auto">
        {{ t.allStaff }}
      </NuxtLink>
    </div>
    <p v-if="error" class="text-red-700">{{ errorMessage(error) }}</p>
    <template v-else-if="data">
      <p>{{ t.total }}: <span class="font-semibold">{{ row?.total ?? 0 }}</span></p>
      <p v-if="!row?.ranges.length" class="text-gray-500">{{ t.none }}</p>
      <ul v-else>
        <li v-for="range in row.ranges" :key="range.from">{{ period(range) }}</li>
      </ul>
    </template>
    <p class="text-xs text-gray-500">{{ t.hint }}</p>
  </section>
</template>
