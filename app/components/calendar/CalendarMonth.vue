<script setup lang="ts">
import { daysInMonth, isWeekend, toIsoDate, weekday } from '#shared/domain/dates'
import { holidayIn, isHolidayIn } from '#shared/domain/holidays'
import type { CalendarEventDto, CalendarKind, YearCalendarDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { type CalendarLabelItem, LANE_HEIGHT, PRINT_LANE_HEIGHT, calendarEventText, calendarLanes, eventRowHeight } from '~/utils/calendarLanes'
import { groupColorClasses } from '~/utils/groups'

/** One month of the year calendar: rows = employees, columns = days, coloured by absence; a last row marks appointments. */
/** `editable`: clicking emits dayClick (employee day), eventDayClick (day number in the header) or eventClick (appointment text). */
/** With `counts` (leave planning) the last row shows people on leave per day instead of appointments; red above `limit`. */
/** `rowHeight` (print): fixed height of the employee rows in px, with names and day numbers sized to fit. */
const props = defineProps<{
  calendar: YearCalendarDto; month: number; editable?: boolean; counts?: Record<string, number>; limit?: number | null
  rowHeight?: number
}>()
const emit = defineEmits<{
  dayClick: [employeeId: number, date: string]
  eventDayClick: [date: string]
  eventClick: [event: CalendarEventDto]
}>()

const KIND_CLASSES: Record<CalendarKind, string> = {
  sick: 'bg-red-500', vacation: 'bg-green-500', special_leave: 'bg-lime-300', training: 'bg-sky-500', closed: 'bg-gray-400',
  requested: 'bg-[repeating-linear-gradient(45deg,var(--color-green-200)_0_3px,var(--color-green-400)_3px_6px)]',
}

const dates = computed(() => Array.from({ length: daysInMonth(props.calendar.year, props.month) },
  (_, index) => toIsoDate(props.calendar.year, props.month, index + 1)))
const events = computed(() => props.calendar.events.filter(event => event.date.slice(5, 7) === String(props.month).padStart(2, '0')))
/** Written appointments, then the day's automatic events (read-only), in lanes; see calendarLanes. */
const eventLayout = computed(() => {
  const { labels, laneCount } = calendarLanes(dates.value, events.value, calendarEventText, props.calendar.autoEvents)
  return { labels, height: eventRowHeight(laneCount, !!props.rowHeight) }
})

/**
 * Print (`rowHeight` set): compact layout. Rows are `rowHeight` px as printed, i.e. the cell is 2 px lower because the
 * global print styles add 1 px padding above and below; names grow with the row (9–14 px). Inline styles, since the
 * print styles force line-height 1.25 on all table content. The screen keeps its classes.
 */
const nameStyle = computed(() => (props.rowHeight
  ? { height: `${props.rowHeight - 2}px`, fontSize: `${Math.min(14, Math.max(9, props.rowHeight - 3))}px`, lineHeight: 1 }
  : undefined))
const dayStyle = computed(() => (props.rowHeight ? { height: `${props.rowHeight - 2}px` } : undefined))
const weekdayStyle = computed(() => (props.rowHeight ? { fontSize: '8px', lineHeight: 1 } : undefined))
const dayNumberStyle = computed(() => (props.rowHeight ? { fontSize: '11px', lineHeight: 1 } : undefined))
const eventsLabelStyle = computed(() => (props.rowHeight ? { fontSize: '10px', lineHeight: 1 } : undefined))
const laneHeight = computed(() => (props.rowHeight ? PRINT_LANE_HEIGHT : LANE_HEIGHT))
function labelStyle(label: { start: number; width: number; lane: number }) {
  const place = { left: percent(label.start), maxWidth: percent(label.width), top: `${label.lane * laneHeight.value + (props.rowHeight ? 1 : 2)}px` }
  return props.rowHeight ? { ...place, fontSize: '10px', lineHeight: `${PRINT_LANE_HEIGHT}px` } : place
}
function onLabelClick(item: CalendarLabelItem) {
  if (props.editable && item.kind === 'event') emit('eventClick', item.event)
}
const percent = (days: number) => `${(days / dates.value.length) * 100}%`
const onHoliday = (date: string) => isHolidayIn(date, props.calendar.holidays)
const isOff = (date: string) => isWeekend(date) || onHoliday(date)

/** Days off of part-time staff look like weekends. */
const freeDays = computed(() => new Map(Object.entries(props.calendar.freeDays).map(([id, dates]) => [Number(id), new Set(dates)])))

/** Name of the public holiday on that date, if any (holidays are computed, not entered). */
function holidayName(date: string): string | undefined {
  const key = holidayIn(date, props.calendar.holidays)
  return key ? de.holidays[key] : undefined
}

function cellClass(employeeId: number, date: string): string {
  const kind = props.calendar.days[employeeId]?.[date]
  if (kind) return KIND_CLASSES[kind]
  if (onHoliday(date)) return KIND_CLASSES.closed
  return isWeekend(date) || freeDays.value.get(employeeId)?.has(date) ? 'bg-gray-100' : ''
}

function cellTitle(employeeId: number, name: string, date: string): string | undefined {
  const kind = props.calendar.days[employeeId]?.[date]
  if (kind) return `${name}: ${de.calendar.kinds[kind]}`
  return holidayName(date)
}

function headerTitle(date: string): string | undefined {
  return [holidayName(date), props.editable ? de.calendar.addEventHint : undefined].filter(Boolean).join('\n') || undefined
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
          v-for="date in dates" :key="date" class="border border-gray-300 px-0 py-0.5 text-center"
          :class="[
            onHoliday(date) ? 'bg-gray-400 font-semibold text-white' : isWeekend(date) ? 'bg-gray-100 font-normal text-gray-500' : 'bg-gray-50 font-normal',
            editable ? 'cursor-pointer hover:bg-yellow-200' : '',
          ]"
          :title="headerTitle(date)"
          @click="editable && emit('eventDayClick', date)"
        >
          <div class="text-[9px] leading-none opacity-75" :style="weekdayStyle">{{ de.weekdaysShort[weekday(date)] }}</div>
          <div :style="dayNumberStyle">{{ Number(date.slice(8)) }}</div>
        </th>
        <th v-for="n in 31 - dates.length" :key="`pad-${n}`" class="border-0" />
      </tr>
    </thead>
    <tbody>
      <tr v-for="employee in calendar.employees" :key="employee.id">
        <td
          class="truncate border border-gray-300 px-1" :class="[employee.color ? groupColorClasses[employee.color] : '', rowHeight ? 'py-0' : 'py-0.5']"
          :style="nameStyle" :title="employee.name"
        >
          {{ employee.name }}
        </td>
        <td
          v-for="date in dates" :key="date" class="border border-gray-300 p-0" :style="dayStyle"
          :class="[cellClass(employee.id, date), rowHeight ? '' : 'h-5', editable ? 'cursor-pointer hover:outline-2 hover:-outline-offset-2 hover:outline-sky-500' : '']"
          :title="cellTitle(employee.id, employee.name, date)"
          @click="editable && emit('dayClick', employee.id, date)"
        />
        <td v-for="n in 31 - dates.length" :key="`pad-${n}`" class="border-0" />
      </tr>
      <tr v-if="counts">
        <td class="border border-gray-300 bg-gray-50 px-1 py-0.5 font-medium">{{ de.leavePlanning.countRow }}</td>
        <td
          v-for="date in dates" :key="date" class="border border-gray-300 p-0 text-center"
          :class="limit != null && (counts[date] ?? 0) > limit ? 'bg-purple-600 font-semibold text-white' : isOff(date) ? 'bg-gray-100' : ''"
          :title="limit != null && (counts[date] ?? 0) > limit ? de.leavePlanning.overLimit(counts[date] ?? 0, limit) : undefined"
        >
          {{ counts[date] || '' }}
        </td>
        <td v-for="n in 31 - dates.length" :key="`pad-${n}`" class="border-0" />
      </tr>
      <tr v-else>
        <td class="border border-gray-300 bg-gray-50 px-1 py-0.5 font-medium" :style="eventsLabelStyle">{{ de.calendar.events }}</td>
        <td :colspan="dates.length" class="relative border border-gray-300 p-0" :style="{ height: `${eventLayout.height}px` }">
          <!-- day grid behind the texts (same columns and shading as the rows above) -->
          <div
            v-for="(date, index) in dates" :key="date" class="absolute inset-y-0 border-r border-gray-300 last:border-r-0"
            :class="isOff(date) ? 'bg-gray-100' : ''" :style="{ left: percent(index), width: percent(1) }"
          />
          <template v-for="label in eventLayout.labels" :key="label.key">
            <div
              v-if="label.item.kind === 'event'"
              class="absolute truncate rounded-sm bg-yellow-300 px-0.5 leading-[14px]" :class="editable ? 'cursor-pointer hover:bg-yellow-400' : ''"
              :title="label.text"
              :style="labelStyle(label)"
              @click="onLabelClick(label.item)"
            >
              {{ label.text }}
            </div>
            <!-- Automatic events: read-only, grey italic with a small icon, never clickable. -->
            <div
              v-else
              class="absolute truncate rounded-sm bg-white px-0.5 italic leading-[14px] text-gray-600 ring-1 ring-inset ring-gray-300"
              :title="`${label.text}\n${de.plan.autoEventsHint}`"
              :style="labelStyle(label)"
            >
              <UIcon name="i-lucide-sparkles" class="mr-0.5 size-2.5 align-[-1px]" aria-hidden="true" />{{ label.text }}
            </div>
          </template>
        </td>
        <td v-for="n in 31 - dates.length" :key="`pad-${n}`" class="border-0" />
      </tr>
    </tbody>
  </table>
</template>
