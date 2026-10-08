<script setup lang="ts">
import { cellFillColor, cellKey, noteKey } from '#shared/domain/cells'
import { formatDuration, formatSignedDuration } from '#shared/domain/time'
import type { DayRowDto, EntryDto, MonthPlanDto, NoteField, WeekSummaryDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { balanceClass, cellFillClasses } from '~/utils/colors'
import { pendingChangeText, releasedChangeText } from '~/utils/changes'
import { formatDayShort } from '~/utils/format'
import { busyCellKeys, isMarker } from '~/utils/helpOuts'
import { indexWarnings, warningText } from '~/utils/warnings'

const props = defineProps<{
  plan: MonthPlanDto
  selected?: Set<string>
  editable?: boolean
  selectedDate?: string | null
  /** The print view: helper columns say "(Aushilfe)", help-outs elsewhere are plain text. */
  print?: boolean
}>()
const emit = defineEmits<{
  cellClick: [employeeId: number, date: string, event: MouseEvent]
  dateClick: [date: string]
  noteSave: [date: string, field: NoteField, value: string]
  removeEntry: [id: number]
  editEntry: [entry: EntryDto]
  saveWeek: [weekStart: string]
  applyWeek: [weekStart: string]
  removeHelper: [helpOutId: number, name: string]
}>()

/** A timed entry in an already selected cell opens the edit dialog on click; the first click selects the cell. */
function isEntryEditable(key: string, entry: EntryDto): boolean {
  return !!props.editable && !!props.selected?.has(key) && entry.start !== null
}

function onEntryClick(key: string, entry: EntryDto, event: MouseEvent) {
  if (!isEntryEditable(key, entry) || event.shiftKey || event.ctrlKey || event.metaKey) return
  event.stopPropagation()
  emit('editEntry', entry)
}

// Own scroll area sized to end at the window bottom, so the page does not scroll as well.
const scroller = ref<HTMLElement | null>(null)
const gridMaxHeight = useFitToViewport(scroller)

const NOTE_FIELDS: NoteField[] = ['info1', 'info2']
const employeeNames = computed(() => new Map(props.plan.employees.map(employee => [employee.id, employee.name])))
const warnings = computed(() => indexWarnings(props.plan.admin?.warnings ?? []))

/** Helper columns ("Aushilfe aus …"): no overtime rows; removable while they hold no entries. */
const helperColumns = computed(() => new Set(props.plan.employees.filter(employee => employee.helpFrom).map(employee => employee.id)))
const helpOutIds = computed(() => new Map((props.plan.admin?.helpers ?? []).map(helper => [helper.employeeId, helper.helpOutId])))
const withEntries = computed(() => new Set(props.plan.entries.map(entry => entry.employeeId)))
function removableHelpOut(employeeId: number): number | null {
  if (!props.editable || withEntries.value.has(employeeId)) return null
  return helpOutIds.value.get(employeeId) ?? null
}
/** Helper days that belong to another plan: "belegt", not selectable. */
const busy = computed(() => busyCellKeys(props.plan))

function onCellClick(cell: { busy: boolean; employeeId: number }, date: string, event: MouseEvent) {
  if (!cell.busy) emit('cellClick', cell.employeeId, date, event)
}

/** A help-out elsewhere is one read-only chip: "Aushilfe in …" with the times of its entries. */
function markerOf(cellEntries: EntryDto[]): { facility: string; lines: string[] } | null {
  const markers = cellEntries.filter(entry => isMarker(entry, props.plan.facilityId))
  if (markers.length === 0) return null
  return {
    facility: props.plan.facilityNames[markers[0]!.helpFacilityId!] ?? '?',
    lines: markers.map(entry => (entry.kind === 'break' ? de.plan.breakEntry(entry.label.slice(1, -1)) : entry.label)),
  }
}

const entriesByCell = computed(() => {
  const map = new Map<string, EntryDto[]>()
  for (const entry of props.plan.entries) {
    const key = cellKey(entry.employeeId, entry.date)
    map.set(key, [...(map.get(key) ?? []), entry])
  }
  return map
})

const weekByLastDay = computed(() => {
  const map = new Map<string, WeekSummaryDto>()
  for (const week of props.plan.admin?.weeks ?? []) {
    const last = props.plan.days.filter(day => day.date >= week.weekStart && day.date <= week.weekEnd).at(-1)
    if (last) map.set(last.date, week)
  }
  return map
})

function joinLines(lines: (string | undefined)[]): string | undefined {
  return lines.filter(Boolean).join('\n') || undefined
}

function markClass(item: { pending: boolean; changed: boolean }): string {
  if (item.pending) return 'outline-2 -outline-offset-2 outline-dashed outline-orange-500 print:outline-none'
  return item.changed ? 'outline-2 -outline-offset-2 outline-orange-400' : ''
}

/** Admin-only, under each name: balance today and the balance at the end of the shown month with all its planned shifts. */
const headerBalances = computed(() => new Map((props.plan.admin?.balances ?? []).map(balance => [balance.employeeId, [
  { label: de.plan.headerToday, hint: de.plan.balanceTodayHint, minutes: balance.today },
  { label: de.plan.headerPlanned, hint: de.plan.balancePlannedHint, minutes: balance.monthEnd },
]])))

/** Admin-only month footer: carry-over, this month's difference and the resulting total per employee. */
const totals = computed(() => {
  const balances = props.plan.admin?.balances
  if (!balances) return []
  const byEmployee = new Map(balances.map(balance => [balance.employeeId, balance]))
  const column = (pick: (carry: number, total: number) => number) => props.plan.employees.map((employee) => {
    if (helperColumns.value.has(employee.id)) return null
    const balance = byEmployee.get(employee.id)
    return balance ? pick(balance.previousMonthEnd, balance.monthEnd) : 0
  })
  return [
    { label: de.plan.totalsCarryOver, values: column(carry => carry) },
    { label: de.plan.totalsMonth, values: column((carry, total) => total - carry) },
    { label: de.plan.totalsTotal, values: column((_, total) => total) },
  ]
})

const columnCount = computed(() => props.plan.employees.length + (props.plan.admin ? 4 : 3))

/** A blank separator row closes every week (after its KW row for admins, after Sunday for observers), except at month end. */
function endsWeek(row: { day: DayRowDto; week: unknown }, index: number): boolean {
  if (index === rows.value.length - 1) return false
  return props.plan.admin ? row.week !== null : row.day.weekday === 6
}

function rowClass(day: DayRowDto): string {
  if (day.holidayKey || day.closureLabel) return 'bg-blue-50'
  return day.isWeekend ? 'bg-gray-100 text-gray-500' : 'bg-white'
}

const rows = computed(() => props.plan.days.map((day) => {
  const cells = props.plan.employees.map((employee) => {
    const key = cellKey(employee.id, day.date)
    const cellWarnings = warnings.value.byCell.get(key) ?? []
    const gap = cellWarnings.find(warning => warning.type === 'target_gap')
    const pending = props.plan.admin?.pendingChanges[key]
    const cellEntries = entriesByCell.value.get(key) ?? []
    const marker = markerOf(cellEntries)
    return {
      key,
      employeeId: employee.id,
      busy: busy.value.has(key),
      marker,
      entries: marker ? [] : cellEntries,
      changed: Boolean(props.plan.changes[key]),
      pending: Boolean(pending),
      missing: cellWarnings.some(warning => warning.type === 'missing_entry'),
      fill: marker ? null : cellFillColor(cellEntries),
      gapMinutes: gap?.type === 'target_gap' ? gap.missingMinutes : null,
      actual: props.plan.admin?.actuals[key] ?? null,
      title: joinLines([
        busy.value.has(key) ? de.plan.helperBusyHint : undefined,
        marker && props.editable ? de.plan.markerHint : undefined,
        pendingChangeText(pending),
        releasedChangeText(props.plan.changes[key]),
        ...cellWarnings.map(warning => warningText(warning, employeeNames.value)),
      ]),
    }
  })
  const notes = NOTE_FIELDS.map((field) => {
    const key = noteKey(field, day.date)
    const notePending = props.plan.admin?.pendingChanges[key]
    return {
      field,
      value: day[field],
      changed: Boolean(props.plan.changes[key]),
      pending: Boolean(notePending),
      title: joinLines([pendingChangeText(notePending), releasedChangeText(props.plan.changes[key])]),
    }
  })
  const dayWarnings = warnings.value.byDate.get(day.date) ?? []
  const week = weekByLastDay.value.get(day.date)
  return {
    day,
    cells,
    notes,
    hasWarnings: dayWarnings.length > 0,
    warningTitle: joinLines(dayWarnings.map(warning => warningText(warning, employeeNames.value))),
    week: week
      ? {
          number: week.weekNumber,
          start: week.weekStart,
          templateName: week.templateName,
          // Helpers' hours count in their home facility: their column stays empty.
          totals: props.plan.employees.map(employee => ({
            employeeId: employee.id,
            total: helperColumns.value.has(employee.id)
              ? null
              : week.totals.find(total => total.employeeId === employee.id) ?? { employeeId: employee.id, target: 0, credit: 0, delta: 0 },
          })),
        }
      : null,
  }
}))
</script>

<template>
  <!-- Own scroll area so the name row (top) and the date column (left) stay visible while scrolling. -->
  <div
    ref="scroller" class="max-h-(--grid-max-h) overflow-auto rounded-lg ring-1 ring-gray-200 print:max-h-none print:overflow-visible print:ring-0"
    :style="{ '--grid-max-h': gridMaxHeight ?? 'calc(100dvh - 10rem)' }"
  >
    <table class="w-full border-collapse text-sm">
      <thead class="sticky top-0 z-20 bg-gray-100 text-xs text-gray-600 shadow-[0_1px_0_var(--color-gray-300)] print:static print:shadow-none">
        <tr>
          <th class="sticky left-0 z-30 w-28 border border-gray-200 bg-gray-100 px-2 py-1 text-left">{{ de.plan.date }}</th>
          <th v-for="employee in plan.employees" :key="employee.id" class="min-w-28 border border-gray-200 bg-gray-100 px-2 py-1">
            <div>{{ employee.name }}</div>
            <template v-if="employee.helpFrom">
              <div v-if="print" class="font-normal">{{ de.plan.helperPrint }}</div>
              <div v-else class="whitespace-nowrap font-normal text-gray-500">
                {{ de.plan.helperFrom(employee.helpFrom) }}
                <button
                  v-if="removableHelpOut(employee.id) !== null" type="button"
                  class="ml-1 align-middle text-gray-400 hover:text-red-600 print:hidden"
                  :title="de.plan.removeHelper" :aria-label="de.plan.removeHelper"
                  @click="emit('removeHelper', removableHelpOut(employee.id)!, employee.name)"
                >
                  <UIcon name="i-lucide-user-minus" />
                </button>
              </div>
            </template>
            <template v-if="headerBalances.has(employee.id)">
              <div
                v-for="line in headerBalances.get(employee.id)" :key="line.label"
                class="whitespace-nowrap font-normal" :title="line.hint"
              >
                <span class="text-gray-500">{{ line.label }}</span>
                <span class="ml-1" :class="balanceClass(line.minutes)">{{ formatSignedDuration(line.minutes) }} h</span>
              </div>
            </template>
          </th>
          <th class="min-w-32 border border-gray-200 bg-gray-100 px-2 py-1">{{ de.plan.info1 }}</th>
          <th class="min-w-32 border border-gray-200 bg-gray-100 px-2 py-1">{{ de.plan.info2 }}</th>
          <th v-if="plan.admin" class="w-8 border border-gray-200 bg-gray-100 px-1 py-1 print:hidden"><UIcon name="i-lucide-triangle-alert" /></th>
        </tr>
      </thead>
      <tbody>
        <template v-for="(row, index) in rows" :key="row.day.date">
          <tr :class="rowClass(row.day)">
            <td
              class="sticky left-0 z-10 border border-gray-200 px-2 py-1 align-top"
              :class="[rowClass(row.day), selectedDate === row.day.date ? 'ring-2 ring-inset ring-sky-500' : '']"
            >
              <button type="button" class="text-left font-medium hover:underline" @click="emit('dateClick', row.day.date)">
                {{ formatDayShort(row.day.date, row.day.weekday) }}
              </button>
              <div v-if="row.day.holidayKey" class="text-xs text-blue-700">{{ de.holidays[row.day.holidayKey] }}</div>
              <div v-else-if="row.day.closureLabel" class="text-xs text-blue-700">{{ row.day.closureLabel }}</div>
            </td>
            <td
              v-for="cell in row.cells" :key="cell.key"
              class="border border-gray-200 px-1 py-1 align-top"
              :class="[
                editable && !cell.busy ? 'cursor-pointer hover:bg-sky-50' : '',
                selected?.has(cell.key) ? 'bg-sky-100'
                : cell.missing ? 'bg-red-50' : cell.busy ? 'bg-gray-50' : cell.fill ? cellFillClasses[cell.fill] : '',
                markClass(cell),
              ]"
              :title="cell.title"
              @click="onCellClick(cell, row.day.date, $event)"
            >
              <div class="flex flex-col items-start gap-0.5">
                <span v-if="cell.busy" class="text-xs italic text-gray-400">{{ de.plan.helperBusy }}</span>
                <span v-if="cell.marker && print" class="text-xs text-gray-600">
                  {{ de.myPlan.helpOutIn(cell.marker.facility) }} {{ cell.marker.lines.join(', ') }}
                </span>
                <span
                  v-else-if="cell.marker"
                  class="inline-flex flex-col whitespace-nowrap rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 ring-1 ring-gray-300"
                >
                  <span class="font-medium">{{ de.myPlan.helpOutIn(cell.marker.facility) }}</span>
                  <span v-for="(line, lineIndex) in cell.marker.lines" :key="lineIndex">{{ line }}</span>
                </span>
                <PlanEntryChip
                  v-for="entry in cell.entries" :key="entry.id" :entry="entry" :removable="editable"
                  :editable="isEntryEditable(cell.key, entry)" :cell-title="cell.title"
                  @remove="emit('removeEntry', $event)" @click="onEntryClick(cell.key, entry, $event)"
                />
                <span v-if="cell.gapMinutes !== null" class="text-xs text-amber-700">{{ de.plan.stillMissing(formatDuration(cell.gapMinutes)) }}</span>
                <NuxtLink
                  v-if="cell.actual" :to="`/admin/time?employee=${cell.employeeId}&year=${plan.year}&month=${plan.month}&date=${row.day.date}`"
                  class="text-xs hover:underline" :class="cell.actual.deviates || cell.actual.open ? 'font-medium text-orange-600' : 'text-gray-500'"
                  @click.stop
                >
                  {{ de.time.recorded }} {{ formatDuration(cell.actual.minutes) }}<template v-if="cell.actual.open"> ({{ de.time.open }})</template>
                </NuxtLink>
              </div>
            </td>
            <td
              v-for="note in row.notes" :key="note.field"
              class="border border-gray-200 px-1 py-1 align-top"
              :class="markClass(note)"
              :title="note.title"
            >
              <input
                v-if="editable" :value="note.value" maxlength="200"
                class="w-full rounded border border-transparent bg-transparent px-1 text-xs hover:border-gray-300 focus:border-sky-500 focus:outline-none"
                @change="emit('noteSave', row.day.date, note.field, ($event.target as HTMLInputElement).value)"
              >
              <span v-else class="text-xs">{{ note.value }}</span>
            </td>
            <td v-if="plan.admin" class="border border-gray-200 px-1 py-1 text-center align-top print:hidden" :title="row.warningTitle">
              <UIcon v-if="row.hasWarnings" name="i-lucide-triangle-alert" class="text-red-600" />
            </td>
          </tr>
          <tr v-if="row.week" class="bg-gray-50 text-xs">
            <td class="sticky left-0 z-10 border border-gray-200 bg-gray-50 px-2 py-1 font-medium">
              {{ de.plan.week(row.week.number) }}
              <div v-if="row.week.templateName" class="font-normal text-sky-700" :title="de.weekTemplates.markHint">
                {{ de.weekTemplates.mark(row.week.templateName) }}
              </div>
            </td>
            <template v-for="column in row.week.totals" :key="column.employeeId">
              <td
                v-if="column.total" class="border border-gray-200 px-2 py-1 text-center font-medium"
                :class="balanceClass(column.total.delta)"
                :title="de.plan.weekTooltip(formatDuration(column.total.target), formatDuration(column.total.credit))"
              >
                {{ formatSignedDuration(column.total.delta) }}
              </td>
              <td v-else class="border border-gray-200" />
            </template>
            <td :colspan="plan.admin ? 3 : 2" class="border border-gray-200 px-2 py-1 text-gray-500">
              <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>{{ de.plan.weekHint }}</span>
                <template v-if="editable">
                  <button type="button" class="text-sky-700 hover:underline print:hidden" @click="emit('saveWeek', row.week.start)">
                    {{ de.weekTemplates.saveWeek }}
                  </button>
                  <button type="button" class="text-sky-700 hover:underline print:hidden" @click="emit('applyWeek', row.week.start)">
                    {{ de.weekTemplates.applyWeek }}
                  </button>
                </template>
              </div>
            </td>
          </tr>
          <tr v-if="endsWeek(row, index)" aria-hidden="true">
            <td :colspan="columnCount" class="h-4 border-x-0 bg-white print:h-2" />
          </tr>
        </template>
      </tbody>
      <tfoot v-if="totals.length" class="bg-gray-50 text-xs">
        <tr aria-hidden="true">
          <td :colspan="columnCount" class="h-4 border-x-0 bg-white print:h-2" />
        </tr>
        <tr v-for="(row, index) in totals" :key="row.label" :class="index === totals.length - 1 ? 'font-semibold' : ''">
          <td class="sticky left-0 z-10 border border-gray-200 bg-gray-50 px-2 py-1">{{ row.label }}</td>
          <td
            v-for="(minutes, column) in row.values" :key="column"
            class="border border-gray-200 px-2 py-1 text-center" :class="minutes === null ? '' : balanceClass(minutes)"
          >
            <template v-if="minutes !== null">{{ formatSignedDuration(minutes) }}</template>
          </td>
          <td :colspan="plan.admin ? 3 : 2" class="border border-gray-200" />
        </tr>
      </tfoot>
    </table>
  </div>
</template>
