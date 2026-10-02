<script setup lang="ts">
import { daysInMonth, isWeekend, toIsoDate } from '#shared/domain/dates'
import { isHoliday } from '#shared/domain/holidays'
import { formatTime } from '#shared/domain/time'
import type { CalendarEventDto, CalendarKind, YearCalendarDto } from '#shared/types/api'
import { de } from '~/locales/de'

/** One month of the year calendar: rows = employees, columns = days, coloured by absence; a last row marks appointments. */
const props = defineProps<{ calendar: YearCalendarDto; month: number }>()

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

/** Appointment texts per day for the appointments row (shown as tooltip). */
const eventsByDate = computed(() => {
  const map = new Map<string, string[]>()
  for (const event of events.value) map.set(event.date, [...(map.get(event.date) ?? []), eventText(event)])
  return map
})
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
          :class="cellClass(employee.id, date)" :title="cellTitle(employee.id, employee.name, date)"
        />
        <td v-for="n in 31 - dates.length" :key="`pad-${n}`" class="border-0" />
      </tr>
      <tr>
        <td class="border border-gray-300 bg-gray-50 px-1 py-0.5 font-medium">{{ de.calendar.events }}</td>
        <td
          v-for="date in dates" :key="date" class="h-5 border border-gray-300 p-0"
          :class="eventsByDate.has(date) ? 'bg-yellow-300' : isOff(date) ? 'bg-gray-100' : ''"
          :title="eventsByDate.get(date)?.join('\n')"
        />
        <td v-for="n in 31 - dates.length" :key="`pad-${n}`" class="border-0" />
      </tr>
    </tbody>
  </table>
</template>
