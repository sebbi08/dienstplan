<script setup lang="ts">
import { weekday } from '#shared/domain/dates'
import { formatTime } from '#shared/domain/time'
import { nowInBerlin } from '#shared/domain/timeRecords'
import type { ChildCountsDto, ChildCountsLineDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'

/**
 * „Kinder heute“ at the tablet, for a person with „Nur Kinderzahlen“ (the middleware sends them here and everyone else
 * away): today's numbers of the attendance list's summary line – da, noch nicht da, abwesend, abgeholt – and the
 * children counted for each meal, per group as well when the facility has more than one. No names, no records.
 * Refreshed every minute and when the tablet wakes up; reading is no use of the tablet, so its lock time keeps running
 * (touches count through the lock bar).
 */
const s = de.terminal.countsToday
const REFRESH_MS = 60_000

const { data, error, refresh } = await useFetch<ChildCountsDto>('/api/terminal/children/counts', { key: 'child-counts-today' })
/** When the numbers came (the tablet's clock, Berlin time); set in the browser only. */
const loadedAt = ref<number | null>(null)
watch(data, () => (loadedAt.value = Date.now()))

let timer: ReturnType<typeof setInterval> | undefined
function onVisible() {
  if (document.visibilityState === 'visible') void refresh()
}
onMounted(() => {
  loadedAt.value = Date.now()
  timer = setInterval(() => void refresh(), REFRESH_MS)
  document.addEventListener('visibilitychange', onVisible)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  document.removeEventListener('visibilitychange', onVisible)
})

const dayText = computed(() => (data.value ? s.day(`${de.weekdaysShort[weekday(data.value.date)]}, ${formatDate(data.value.date)}`) : ''))
const updatedText = computed(() => (loadedAt.value === null ? '' : s.updatedAt(formatTime(nowInBerlin(new Date(loadedAt.value)).minutes))))

/** The four numbers of the day, as on the attendance list's summary line. */
const STATUS = [
  { key: 'present', label: s.present, tone: 'bg-green-50 text-green-900 ring-green-300' },
  { key: 'notYet', label: s.notYet, tone: 'bg-white text-gray-900 ring-gray-300' },
  { key: 'absent', label: s.absent, tone: 'bg-amber-50 text-amber-900 ring-amber-300' },
  { key: 'gone', label: s.gone, tone: 'bg-sky-50 text-sky-900 ring-sky-300' },
] as const satisfies readonly { key: keyof Omit<ChildCountsLineDto, 'meals'>; label: string; tone: string }[]
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-4">
    <div class="flex flex-wrap items-end gap-x-4 gap-y-2">
      <div class="min-w-0 flex-1">
        <h1 class="text-2xl font-semibold">{{ s.title }}</h1>
        <p class="text-base text-gray-700">{{ dayText }}</p>
      </div>
      <div class="flex items-center gap-2">
        <p class="text-sm text-gray-500" aria-live="polite">{{ updatedText }}</p>
        <UButton size="lg" class="min-h-11" color="neutral" variant="outline" icon="i-lucide-refresh-cw" :label="s.refresh" @click="refresh()" />
      </div>
    </div>

    <UAlert v-if="error" color="warning" variant="soft" :title="errorMessage(error)" />
    <template v-else-if="data">
      <p v-if="!data.isCareDay" class="rounded-md bg-gray-100 px-3 py-2 text-base text-gray-700">{{ s.noCareDay }}</p>

      <ul class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <li v-for="item in STATUS" :key="item.key" class="rounded-xl px-3 py-4 text-center ring-1" :class="item.tone">
          <div class="text-5xl font-bold tabular-nums">{{ data.total[item.key] }}</div>
          <div class="mt-1 text-lg font-medium">{{ item.label }}</div>
        </li>
      </ul>

      <section class="space-y-2 rounded-xl bg-white p-4 ring-1 ring-gray-200">
        <h2 class="text-lg font-semibold">{{ s.meals }}</h2>
        <p v-if="!data.meals.length" class="text-base text-gray-600">{{ s.noMeals }}</p>
        <ul v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <li v-for="(meal, index) in data.meals" :key="`${meal.name}-${meal.time}`" class="rounded-lg border border-gray-300 bg-gray-50 px-3 py-3 text-center">
            <div class="text-sm font-medium text-gray-600">{{ s.mealHead(meal.name, formatTime(meal.time)) }}</div>
            <div class="text-2xl font-semibold tabular-nums text-gray-900">{{ s.children(data.total.meals[index] ?? 0) }}</div>
          </li>
        </ul>
      </section>

      <!-- Per group only in a facility with more than one group (the server sends none otherwise). -->
      <section v-if="data.groups.length" class="space-y-2 rounded-xl bg-white p-4 ring-1 ring-gray-200">
        <h2 class="text-lg font-semibold">{{ s.groups }}</h2>
        <div class="overflow-x-auto">
          <table class="w-full text-base">
            <thead class="text-sm text-gray-500">
              <tr>
                <th scope="col" class="px-2 py-1 text-left font-medium">{{ s.group }}</th>
                <th v-for="item in STATUS" :key="item.key" scope="col" class="px-2 py-1 text-right font-medium">{{ item.label }}</th>
                <th
                  v-for="meal in data.meals" :key="`${meal.name}-${meal.time}`" scope="col"
                  class="border-l border-gray-300 px-2 py-1 text-right font-medium whitespace-nowrap"
                >
                  {{ meal.name }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(group, row) in data.groups" :key="`${row}-${group.name}`" class="border-t border-gray-100">
                <th scope="row" class="px-2 py-1.5 text-left font-normal">{{ group.name ?? s.noGroup }}</th>
                <td v-for="item in STATUS" :key="item.key" class="px-2 py-1.5 text-right tabular-nums">{{ group[item.key] }}</td>
                <td v-for="(count, index) in group.meals" :key="index" class="border-l border-gray-300 px-2 py-1.5 text-right tabular-nums">{{ count }}</td>
              </tr>
              <tr class="border-t border-gray-300 font-semibold">
                <th scope="row" class="px-2 py-1.5 text-left font-semibold">{{ s.total }}</th>
                <td v-for="item in STATUS" :key="item.key" class="px-2 py-1.5 text-right tabular-nums">{{ data.total[item.key] }}</td>
                <td v-for="(count, index) in data.total.meals" :key="index" class="border-l border-gray-300 px-2 py-1.5 text-right tabular-nums">{{ count }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>
