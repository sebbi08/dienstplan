<script setup lang="ts">
import type { IsoDate } from '#shared/domain/types'
import type { CalendarEventDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { calendarEventTitle, eventDayText } from '~/utils/calendarLanes'

/**
 * A day's appointments in the plan (Info 2, „Mein Dienstplan“): yellow like in the year calendar, the whole text
 * wrapped. With `editable` (whoever manages the calendar) a click opens the appointment to change it.
 */
defineProps<{ events: CalendarEventDto[]; date: IsoDate; editable?: boolean }>()
const emit = defineEmits<{ eventClick: [event: CalendarEventDto] }>()
</script>

<template>
  <ul v-if="events.length" class="space-y-0.5 text-xs leading-snug">
    <li v-for="event in events" :key="event.id" class="flex">
      <button
        v-if="editable" type="button"
        class="flex min-w-0 items-start gap-1 rounded-sm bg-yellow-200 px-1 text-left break-words hover:bg-yellow-300 focus-visible:outline-2 focus-visible:outline-sky-500"
        :title="`${calendarEventTitle(event)}\n${de.calendar.editEventHint}`" @click.stop="emit('eventClick', event)"
      >
        <UIcon name="i-lucide-calendar-days" class="mt-0.5 size-3 shrink-0" aria-hidden="true" />
        <span class="min-w-0 break-words">{{ eventDayText(event, date) }}</span>
      </button>
      <span
        v-else class="flex min-w-0 items-start gap-1 rounded-sm bg-yellow-200 px-1 break-words"
        :title="calendarEventTitle(event)"
      >
        <UIcon name="i-lucide-calendar-days" class="mt-0.5 size-3 shrink-0" aria-hidden="true" />
        <span class="min-w-0 break-words">{{ eventDayText(event, date) }}</span>
      </span>
    </li>
  </ul>
</template>
