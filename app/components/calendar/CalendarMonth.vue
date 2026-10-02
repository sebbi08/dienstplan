<script setup lang="ts">
import { daysInMonth, isWeekend, toIsoDate } from '#shared/domain/dates'
import { isHoliday } from '#shared/domain/holidays'
import { formatTime } from '#shared/domain/time'
import type { CalendarEventDto, CalendarKind, YearCalendarDto } from '#shared/types/api'
import { de } from '~/locales/de'

/** One month of the year calendar: rows = employees, columns = days, coloured by absence; a last row marks appointments. */
/** `editable`: clicking a day emits dayClick (employee row) or eventDayClick / eventClick (appointments row). */
const props = defineProps<{ calendar: YearCalendarDto; month: number; editable?: boolean }>()
const emit = defineEmits<{
  dayClick: [employeeId: number, date: string]
  eventDayClick: [date: string]
  eventClick: [event: CalendarEventDto]
}>()

const KIND_CLASSES: Record<CalendarKind, string> = {
  sick: 'bg-red-500', vacation: 'bg-green-500', training: 'bg-sky-500', closed: 'bg-gray-400',
}

const dates = computed(() => Array.from({ length: daysInMonth(props.calendar.year, props.month) },
  (_, index) => toIsoDate(props.calendar.year, props.month, index + 1)))
const events = computed(() => props.calendar.events.filter(event => event.date.slice(5, 7) === String(props.month).padStart(2, '0')))
const eventText = (event: CalendarEventDto) => {
  const time = event.start === null ? '' : ` ${formatTime(event.start)}${event.end === null ? '' : `–${formatTime(event.end)}`}`
  return `${Number(event.date.slice(8))}.${time} ${event.title}`
}


/** Rough number of characters that fit into one day column (11 px font, about 26–30 px per day). */
const CHARS_PER_DAY = 4
const LANE_HEIGHT = 15

/**
 * Written appointments in the appointments row: each text starts at its day and runs to the right on one
 * line; when it would run into an earlier text it moves to the next line (lane). A text is cut (with full
 * text as tooltip) only where the next text of its own lane begins.
 */
const eventLayout = computed(() => {
  const days = dates.value.length
  const lanes: number[] = [] // per lane: first free day index
  const labels: { event: CalendarEventDto; text: string; start: number; lane: number; width: number }[] = []
  dates.value.forEach((date, start) => {
    for (const event of events.value.filter(candidate => candidate.date === date)) {
      const text = eventText(event)
      let lane = lanes.findIndex(freeFrom => freeFrom <= start)
      if (lane === -1) lane = lanes.push(0) - 1
      lanes[lane] = start + Math.max(1, Math.ceil(text.length / CHARS_PER_DAY))
      labels.push({ event, text, start, lane, width: days - start })
    }
  })
  for (const label of labels) {
    const next = labels.filter(other => other.lane === label.lane && other.start > label.start).map(other => other.start)
    if (next.length) label.width = Math.min(...next) - label.start
  }
  return { labels, height: Math.max(1, lanes.length) * LANE_HEIGHT + 4 }
})
const percent = (days: number) => `${(days / dates.value.length) * 100}%`
const isOff = (date: string) => isWeekend(date) || isHoliday(date)

function cellClass(employeeId: number, date: string): string {
  const kind = props.calendar.days[employeeId]?.[date]
  if (kind) return KIND_CLASSES[kind]
  return isOff(date) ? 'bg-gray-100' : ''
}

function cellTitle(employeeId: number, name: string, date: string): string | undefined {
  const kind = props.calendar.days[employeeId]?.[date]
  return kind ? `${name}: ${de.calendar.kinds[kind]}` : undefined
}
</script>

<template>
  <table class="w-full table-fixed border-collapse text-[11px]" style="print-color-adjust: exact; -webkit-print-color-adjust: exact">
    <colgroup>
      <col class="w-24">
      <col v-for="date in dates" :key="date">
      <col v-for="n in 31 - dates.length" :key="`pad-${n}`">
    </colgroup>
    <thead>
      <tr>
        <th class="border border-gray-300 bg-gray-50 px-1 py-0.5 text-left text-xs">{{ de.months[month - 1] }}</th>
        <th
          v-for="date in dates" :key="date" class="border border-gray-300 px-0 py-0.5 text-center font-normal"
          :class="isOff(date) ? 'bg-gray-100 text-gray-500' : 'bg-gray-50'"
        >
          {{ Number(date.slice(8)) }}
        </th>
        <th v-for="n in 31 - dates.length" :key="`pad-${n}`" class="border-0" />
      </tr>
    </thead>
    <tbody>
      <tr v-for="employee in calendar.employees" :key="employee.id">
        <td class="truncate border border-gray-300 px-1 py-0.5" :title="employee.name">{{ employee.name }}</td>
        <td
          v-for="date in dates" :key="date" class="h-5 border border-gray-300 p-0"
          :class="[cellClass(employee.id, date), editable ? 'cursor-pointer hover:outline-2 hover:-outline-offset-2 hover:outline-sky-500' : '']"
          :title="cellTitle(employee.id, employee.name, date)"
          @click="editable && emit('dayClick', employee.id, date)"
        />
        <td v-for="n in 31 - dates.length" :key="`pad-${n}`" class="border-0" />
      </tr>
      <tr>
        <td class="border border-gray-300 bg-gray-50 px-1 py-0.5 font-medium">{{ de.calendar.events }}</td>
        <td :colspan="dates.length" class="relative border border-gray-300 p-0" :style="{ height: `${eventLayout.height}px` }">
          <!-- day grid behind the texts (same columns and shading as the rows above) -->
          <div
            v-for="(date, index) in dates" :key="date" class="absolute inset-y-0 border-r border-gray-300 last:border-r-0"
            :class="[isOff(date) ? 'bg-gray-100' : '', editable ? 'cursor-pointer hover:bg-yellow-100' : '']"
            :style="{ left: percent(index), width: percent(1) }"
            @click="editable && emit('eventDayClick', date)"
          />
          <div
            v-for="label in eventLayout.labels" :key="label.event.id"
            class="absolute truncate rounded-sm bg-yellow-300 px-0.5 leading-[14px]" :class="editable ? 'cursor-pointer hover:bg-yellow-400' : ''"
            :title="label.text"
            :style="{ left: percent(label.start), maxWidth: percent(label.width), top: `${label.lane * LANE_HEIGHT + 2}px` }"
            @click="editable && emit('eventClick', label.event)"
          >
            {{ label.text }}
          </div>
        </td>
        <td v-for="n in 31 - dates.length" :key="`pad-${n}`" class="border-0" />
      </tr>
    </tbody>
  </table>
</template>
