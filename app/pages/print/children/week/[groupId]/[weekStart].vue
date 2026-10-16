<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import type { GroupDayLabel, GroupWeekDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'

/** The weekly overview of a group for printing (Leitung and Träger): A4 landscape, the theme and Monday to Friday side by side. */
definePageMeta({ layout: false })
useHead({ style: [{ innerHTML: '@page { size: A4 landscape; margin: 10mm; }' }] })

const route = useRoute()
const groupId = Number(route.params.groupId)
const weekStart = String(route.params.weekStart)
const { data, error } = await useFetch<GroupWeekDto>('/api/group-book/week', {
  query: { groupId, date: weekStart }, key: `print-children-week-${groupId}-${weekStart}`,
})

const s = de.groupBook
const period = computed(() => (data.value
  ? `${s.weekNumber(data.value.weekNumber)} · ${formatDate(data.value.days[0]!.date)} – ${formatDate(data.value.days[4]!.date)}`
  : ''))
const fileName = computed(() => `Wochenuebersicht-${data.value?.groupName ?? groupId}-${weekStart}`)

/** "Feiertag: Allerheiligen" / "Schließtag: <Bezeichnung>" for a greyed day. */
function labelText(label: GroupDayLabel | null): string {
  if (label === null) return ''
  return label.kind === 'holiday' ? s.holiday(de.holidays[label.key]) : s.closure(label.label)
}

</script>

<template>
  <div class="bg-white p-4 text-gray-900">
    <div class="mb-3 flex flex-wrap items-baseline gap-3">
      <h1 class="text-xl font-semibold">
        <template v-if="data">{{ data.facilityName }} – {{ data.groupName }} – {{ period }}</template>
        <template v-else>{{ s.printTitle('') }}</template>
      </h1>
      <PrintActions :file-name="fileName" />
    </div>
    <p v-if="error" class="text-red-700">{{ errorMessage(error) }}</p>
    <template v-else-if="data">
      <section class="mb-3 break-inside-avoid border border-gray-400 p-2">
        <h2 class="text-sm font-semibold">{{ s.theme }}</h2>
        <p class="min-h-12 whitespace-pre-line break-words text-sm">{{ data.theme.text }}</p>
      </section>
      <div class="grid grid-cols-5 gap-0 text-sm">
        <section
          v-for="(day, index) in data.days"
          :key="day.date"
          class="min-h-96 border border-gray-400 p-2"
          :class="[day.label ? 'bg-gray-100' : '', index > 0 ? '-ml-px' : '']"
        >
          <h2 class="font-semibold">{{ s.weekdays[index] }}, {{ formatDate(day.date) }}</h2>
          <p v-if="day.label" class="text-xs font-medium text-gray-600">{{ labelText(day.label) }}</p>
          <p class="mt-1 whitespace-pre-line break-words">{{ day.note.text }}</p>
        </section>
      </div>
      <p class="mt-1 text-xs text-gray-500">{{ s.done }}</p>
    </template>
    <p class="mt-3 text-xs text-gray-500">{{ de.time.printedAt(formatDate(todayIso())) }}</p>
  </div>
</template>
