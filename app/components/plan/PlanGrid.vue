<script setup lang="ts">
import { cellFillColor, cellKey, noteKey } from '#shared/domain/cells'
import { formatDuration, formatSignedDuration, formatTime } from '#shared/domain/time'
import type { DayRowDto, EmployeeColumnDto, EntryDto, MonthPlanDto, NoteField, WeekSummaryDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { balanceClass, cellFillClasses } from '~/utils/colors'
import { pendingChangeText, releasedChangeText } from '~/utils/changes'
import { formatDayShort } from '~/utils/format'
import { planBlocks } from '~/utils/groups'
import { busyCellKeys, isMarker } from '~/utils/helpOuts'
import { dayHoursText } from '~/utils/openingHours'
import { indexWarnings, warningText } from '~/utils/warnings'

const props = defineProps<{
  plan: MonthPlanDto
  selected?: Set<string>
  editable?: boolean
  selectedDate?: string | null
  /** The print view: helper columns say "(Aushilfe)", help-outs elsewhere are plain text. */
  print?: boolean
  /** The group chosen above the plan: only its block is shown, plus the Springer and helpers (null = all). */
  groupFilter?: number | null
  /** A day to scroll into view and highlight briefly (a click on a warning); `at` makes a repeated click jump again. */
  jumpTo?: { date: string; at: number } | null
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
  sickLeave: [employeeId: number, date: string]
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

const flashDate = ref<string | null>(null)
let flashTimer: ReturnType<typeof setTimeout> | undefined
watch(() => props.jumpTo, async (target) => {
  if (!target) return
  await nextTick()
  scroller.value?.querySelector(`tr[data-date="${target.date}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  flashDate.value = target.date
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => {
    flashDate.value = null
  }, 1800)
})
onBeforeUnmount(() => clearTimeout(flashTimer))

const NOTE_FIELDS: NoteField[] = ['info1', 'info2']
const employeeNames = computed(() => new Map(props.plan.employees.map(employee => [employee.id, employee.name])))

/**
 * Columns in blocks (see planBlocks): each group's members and then its "anwesend" column, the Springer, the helpers.
 * Without groups there is one block of all employees, no header row above the names and no attendance column.
 */
type Column = { kind: 'employee'; employee: EmployeeColumnDto } | { kind: 'attendance'; groupId: number }
const blocks = computed(() => planBlocks(props.plan, props.groupFilter ?? null))
const showBlocks = computed(() => props.plan.groups.length > 0)
const columns = computed((): Column[] => blocks.value.flatMap(block => [
  ...block.employees.map(employee => ({ kind: 'employee' as const, employee })),
  ...(block.groupId !== null ? [{ kind: 'attendance' as const, groupId: block.groupId }] : []),
]))
const blockHeaders = computed(() => blocks.value
  .map(block => ({ key: block.key, label: block.label, span: block.employees.length + (block.groupId !== null ? 1 : 0) }))
  .filter(block => block.span > 0))
const groupNames = computed(() => new Map(props.plan.groups.map(group => [group.id, group.name])))
const homeGroups = computed(() => new Map(props.plan.employees.map(employee => [employee.id, employee.groupId ?? null])))
/** The group a duty counts for when it is not the person's home group ("→ Mäuse"); null otherwise. */
function groupTag(entry: EntryDto): string | null {
  if (entry.groupId === null || entry.groupId === homeGroups.value.get(entry.employeeId)) return null
  return groupNames.value.get(entry.groupId) ?? null
}
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

/**
 * "Im Dienst erkrankt" as tooltip of a marked cell; managers only (the markers come with plan.admin) and never in the
 * print view.
 */
function sickLeaveText(key: string): string | undefined {
  const mark = props.print ? undefined : props.plan.admin?.sickLeaves[key]
  if (!mark) return undefined
  return de.sickLeave.tooltip(mark.leftAt === null ? null : formatTime(mark.leftAt)) + (mark.note ? ` · ${mark.note}` : '')
}

function joinLines(lines: (string | undefined)[]): string | undefined {
  return lines.filter(Boolean).join('\n') || undefined
}

/** Orange frames mark changes on screen only; the printout shows the plan without them. */
function markClass(item: { pending: boolean; changed: boolean }): string {
  if (item.pending) return 'outline-2 -outline-offset-2 outline-dashed outline-orange-500 print:outline-none'
  return item.changed ? 'outline-2 -outline-offset-2 outline-orange-400 print:outline-none' : ''
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
  const column = (pick: (carry: number, total: number) => number) => columns.value.map((column) => {
    if (column.kind === 'attendance' || helperColumns.value.has(column.employee.id)) return null
    const balance = byEmployee.get(column.employee.id)
    return balance ? pick(balance.previousMonthEnd, balance.monthEnd) : 0
  })
  return [
    { label: de.plan.totalsCarryOver, values: column(carry => carry) },
    { label: de.plan.totalsMonth, values: column((carry, total) => total - carry) },
    { label: de.plan.totalsTotal, values: column((_, total) => total) },
  ]
})

const columnCount = computed(() => columns.value.length + (props.plan.admin ? 4 : 3))

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
  const cells = columns.value.map((column) => {
    if (column.kind === 'attendance') {
      const count = props.plan.attendance[column.groupId]?.[day.date] ?? 0
      // Nothing on free days nobody works.
      const quiet = count === 0 && (day.isWeekend || Boolean(day.holidayKey) || Boolean(day.closureLabel))
      return {
        kind: 'attendance' as const, key: `attendance-${column.groupId}`, count: quiet ? null : count,
        // The group's own opening hours of the day, small beside its count.
        hours: dayHoursText(day.groupOpening[column.groupId]), groupName: groupNames.value.get(column.groupId) ?? '',
      }
    }
    const employee = column.employee
    const key = cellKey(employee.id, day.date)
    const cellWarnings = warnings.value.byCell.get(key) ?? []
    const gap = cellWarnings.find(warning => warning.type === 'target_gap')
    const pending = props.plan.admin?.pendingChanges[key]
    const cellEntries = entriesByCell.value.get(key) ?? []
    const marker = markerOf(cellEntries)
    const sickLeave = sickLeaveText(key)
    return {
      kind: 'employee' as const,
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
      sickLeave,
      title: joinLines([
        sickLeave,
        busy.value.has(key) && !props.print ? de.plan.helperBusyHint : undefined,
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
          // Helpers' hours count in their home facility: their column stays empty. A group's template name stands
          // in its attendance column (the facility's template name in the KW column).
          totals: columns.value.map(column => (column.kind === 'attendance'
            ? { key: `attendance-${column.groupId}`, total: null, templateName: week.templateNames[String(column.groupId)] ?? null }
            : {
                key: `employee-${column.employee.id}`,
                templateName: null,
                total: helperColumns.value.has(column.employee.id)
                  ? null
                  : week.totals.find(total => total.employeeId === column.employee.id)
                    ?? { employeeId: column.employee.id, target: 0, credit: 0, delta: 0 },
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
      <thead class="sticky top-0 z-20 bg-gray-100 text-xs text-gray-600 shadow-[0_1px_0_var(--color-gray-300)] print:static print:table-header-group print:shadow-none">
        <!-- With groups: the block names above the names; date and info columns span both rows. -->
        <tr v-if="showBlocks">
          <th rowspan="2" class="sticky left-0 z-30 w-28 border border-gray-200 bg-gray-100 px-2 py-1 text-left">{{ de.plan.date }}</th>
          <th
            v-for="block in blockHeaders" :key="block.key" :colspan="block.span"
            class="border border-gray-300 bg-gray-200 px-2 py-1 text-center text-sm font-semibold text-gray-800"
          >
            {{ block.label }}
          </th>
          <th rowspan="2" class="min-w-32 border border-gray-200 bg-gray-100 px-2 py-1">{{ de.plan.info1 }}</th>
          <th rowspan="2" class="min-w-32 border border-gray-200 bg-gray-100 px-2 py-1">{{ de.plan.info2 }}</th>
          <th v-if="plan.admin" rowspan="2" class="w-8 border border-gray-200 bg-gray-100 px-1 py-1 print:hidden"><UIcon name="i-lucide-triangle-alert" /></th>
        </tr>
        <tr>
          <th v-if="!showBlocks" class="sticky left-0 z-30 w-28 border border-gray-200 bg-gray-100 px-2 py-1 text-left">{{ de.plan.date }}</th>
          <template v-for="column in columns" :key="column.kind === 'employee' ? column.employee.id : `attendance-${column.groupId}`">
            <th
              v-if="column.kind === 'attendance'" class="w-14 border border-gray-200 bg-gray-100 px-1 py-1 font-normal italic"
              :title="de.groups.presentHint"
            >
              {{ de.groups.present }}
            </th>
            <th v-else class="min-w-28 border border-gray-200 bg-gray-100 px-2 py-1">
              <div>{{ column.employee.name }}</div>
              <template v-if="column.employee.helpFrom">
                <div v-if="print" class="font-normal">{{ de.plan.helperPrint }}</div>
                <div v-else class="whitespace-nowrap font-normal text-gray-500">
                  {{ de.plan.helperFrom(column.employee.helpFrom) }}
                  <button
                    v-if="removableHelpOut(column.employee.id) !== null" type="button"
                    class="ml-1 align-middle text-gray-400 hover:text-red-600 print:hidden"
                    :title="de.plan.removeHelper" :aria-label="de.plan.removeHelper"
                    @click="emit('removeHelper', removableHelpOut(column.employee.id)!, column.employee.name)"
                  >
                    <UIcon name="i-lucide-user-minus" />
                  </button>
                </div>
              </template>
              <template v-if="headerBalances.has(column.employee.id)">
                <div
                  v-for="line in headerBalances.get(column.employee.id)" :key="line.label"
                  class="whitespace-nowrap font-normal" :title="line.hint"
                >
                  <span class="text-gray-500">{{ line.label }}</span>
                  <span class="ml-1" :class="balanceClass(line.minutes)">{{ formatSignedDuration(line.minutes) }} h</span>
                </div>
              </template>
            </th>
          </template>
          <template v-if="!showBlocks">
            <th class="min-w-32 border border-gray-200 bg-gray-100 px-2 py-1">{{ de.plan.info1 }}</th>
            <th class="min-w-32 border border-gray-200 bg-gray-100 px-2 py-1">{{ de.plan.info2 }}</th>
            <th v-if="plan.admin" class="w-8 border border-gray-200 bg-gray-100 px-1 py-1 print:hidden"><UIcon name="i-lucide-triangle-alert" /></th>
          </template>
        </tr>
      </thead>
      <tbody>
        <template v-for="(row, index) in rows" :key="row.day.date">
          <!-- Printed across pages, a day (and its KW row) is never cut in half; the name rows repeat on each page. -->
          <tr :class="[flashDate === row.day.date ? 'bg-amber-100' : rowClass(row.day), 'break-inside-avoid']" :data-date="row.day.date">
            <td
              class="sticky left-0 z-10 border border-gray-200 px-2 py-1 align-top transition-colors duration-500 print:whitespace-nowrap"
              :class="[flashDate === row.day.date ? 'bg-amber-300' : rowClass(row.day), selectedDate === row.day.date ? 'ring-2 ring-inset ring-sky-500' : '']"
            >
              <button type="button" class="text-left font-medium hover:underline" @click="emit('dateClick', row.day.date)">
                {{ formatDayShort(row.day.date, row.day.weekday) }}
              </button>
              <div v-if="row.day.holidayKey" class="text-xs text-blue-700 print:ml-1 print:inline-block print:max-w-48 print:truncate print:align-bottom">{{ de.holidays[row.day.holidayKey] }}</div>
              <div v-else-if="row.day.closureLabel" class="text-xs text-blue-700 print:ml-1 print:inline-block print:max-w-48 print:truncate print:align-bottom">{{ row.day.closureLabel }}</div>
              <div v-if="dayHoursText(row.day.opening)" class="text-xs font-normal text-gray-500">{{ dayHoursText(row.day.opening) }}</div>
            </td>
            <template v-for="cell in row.cells" :key="cell.key">
              <td
                v-if="cell.kind === 'attendance'" class="border border-gray-200 px-1 py-1 text-center align-top font-semibold"
                :title="de.groups.presentHint"
              >
                {{ cell.count ?? '' }}
                <div v-if="cell.hours" class="whitespace-nowrap text-[10px] font-normal text-gray-500" :title="de.openingHours.planHint(cell.groupName)">
                  {{ cell.hours }}
                </div>
              </td>
              <td
                v-else
                class="border border-gray-200 px-1 py-1 align-top print:py-0!"
                :class="[
                  editable && !cell.busy ? 'cursor-pointer hover:bg-sky-50' : '',
                  selected?.has(cell.key) ? 'bg-sky-100'
                  : cell.missing ? 'bg-red-50' : cell.busy && !print ? 'bg-gray-50' : cell.fill ? cellFillClasses[cell.fill] : '',
                  markClass(cell),
                ]"
                :title="cell.title"
                @click="onCellClick(cell, row.day.date, $event)"
              >
                <div class="flex flex-col items-start gap-0.5 print:gap-0">
                  <span v-if="cell.busy && !print" class="text-xs italic text-gray-600">{{ de.plan.helperBusy }}</span>
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
                    :editable="isEntryEditable(cell.key, entry)" :cell-title="cell.title" :group-name="groupTag(entry)"
                    @remove="emit('removeEntry', $event)" @click="onEntryClick(cell.key, entry, $event)"
                  />
                  <button
                    v-if="cell.sickLeave" type="button" class="inline-flex text-rose-700 hover:text-rose-900 print:hidden"
                    :title="cell.sickLeave" :aria-label="cell.sickLeave" @click.stop="emit('sickLeave', cell.employeeId, row.day.date)"
                  >
                    <UIcon name="i-lucide-thermometer" class="size-4" />
                  </button>
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
            </template>
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
              <!-- After the own Info texts, outside the input: the day's automatic events, read-only. -->
              <PlanAutoEvents v-if="note.field === 'info2'" :events="row.day.autoEvents" class="mt-0.5 px-1" />
            </td>
            <td v-if="plan.admin" class="border border-gray-200 px-1 py-1 text-center align-top print:hidden" :title="row.warningTitle">
              <UIcon v-if="row.hasWarnings" name="i-lucide-triangle-alert" class="text-red-600" />
            </td>
          </tr>
          <tr v-if="row.week" class="break-inside-avoid bg-gray-50 text-xs">
            <td class="sticky left-0 z-10 border border-gray-200 bg-gray-50 px-2 py-1 font-medium print:whitespace-nowrap">
              {{ de.plan.week(row.week.number) }}
              <div v-if="row.week.templateName" class="font-normal text-sky-700 print:ml-1 print:inline print:whitespace-nowrap" :title="de.weekTemplates.markHint">
                {{ de.weekTemplates.mark(row.week.templateName) }}
              </div>
            </td>
            <template v-for="column in row.week.totals" :key="column.key">
              <td
                v-if="column.templateName" class="border border-gray-200 px-1 py-1 text-center text-[11px] leading-tight text-sky-700"
                :title="de.weekTemplates.markHint"
              >
                {{ column.templateName }}
              </td>
              <td
                v-else-if="column.total" class="border border-gray-200 px-2 py-1 text-center font-medium"
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
            <td :colspan="columnCount" class="h-4 border-x-0 bg-white print:h-1" />
          </tr>
        </template>
      </tbody>
      <!-- Printed only once at the end, not repeated at the foot of every page. -->
      <tfoot v-if="totals.length" class="bg-gray-50 text-xs print:table-row-group">
        <tr aria-hidden="true">
          <td :colspan="columnCount" class="h-4 border-x-0 bg-white print:h-1" />
        </tr>
        <tr v-for="(row, index) in totals" :key="row.label" :class="index === totals.length - 1 ? 'font-semibold' : ''">
          <td class="sticky left-0 z-10 border border-gray-200 bg-gray-50 px-2 py-1 print:whitespace-nowrap">{{ row.label }}</td>
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
