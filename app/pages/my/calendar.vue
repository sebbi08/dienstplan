<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import { formatTime } from '#shared/domain/time'
import type { CalendarEventDto, YearCalendarDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'

/** Read-only year calendar for employees: everyone's leave and training, own sick days, shared appointments. */
const year = ref(parseIsoDate(todayIso()).year)
const { data: calendar, error } = await useFetch<YearCalendarDto>('/api/my/calendar', { query: { year } })

const eventTime = (event: CalendarEventDto) =>
  event.start === null ? '' : `${formatTime(event.start)}${event.end === null ? '' : `–${formatTime(event.end)}`}`
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-2xl font-semibold">{{ de.calendar.title }}</h1>
      <YearNav v-model="year" />
    </div>
    <p class="text-sm text-gray-500">{{ de.calendar.staffHint }}</p>
    <UAlert v-if="error" color="warning" variant="soft" :title="errorMessage(error)" />
    <CalendarLegend />

    <div v-if="calendar" class="space-y-3 overflow-x-auto">
      <div v-for="month in 12" :key="month" class="min-w-[900px] rounded-lg bg-white">
        <CalendarMonth :calendar="calendar" :month="month" />
      </div>
    </div>

    <section v-if="calendar?.events.length" class="max-w-3xl space-y-2">
      <h2 class="text-lg font-semibold">{{ de.calendar.eventList }}</h2>
      <ul class="divide-y divide-gray-100 rounded-lg bg-white text-sm ring-1 ring-gray-200">
        <li v-for="event in calendar.events" :key="event.id" class="flex gap-3 px-3 py-2">
          <span class="whitespace-nowrap">{{ formatDate(event.date) }}</span>
          <span class="whitespace-nowrap text-gray-500">{{ eventTime(event) }}</span>
          <span>{{ event.title }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>
