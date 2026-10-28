<script setup lang="ts">
import { addDays, isValidIsoDate, todayIso, weekday } from '#shared/domain/dates'
import { pickupOverdue } from '#shared/domain/childAttendance'
import { formatTime } from '#shared/domain/time'
import { nowInBerlin } from '#shared/domain/timeRecords'
import type { IsoDate } from '#shared/domain/types'
import type { AttendanceChildDto, AttendanceDayDto, AttendanceDayInput } from '#shared/types/api'
import { de } from '~/locales/de'
import { attendanceStatusText, confirmedWithText, parseClock, stayText } from '~/utils/attendance'
import {
  ATTENDANCE_ROW_CLASS, ATTENDANCE_STATUS_CLASS, attendanceQuickAction, attendanceRowTone, attendanceSummaryParts, compactStatusText,
  countedMealNames, closedGroupWarnings, readAttendanceSummaryOpen, readClosedAttendanceGroups, visibleAttendanceRows,
  writeAttendanceSummaryOpen, writeClosedAttendanceGroups,
} from '~/utils/attendanceRow'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'

/**
 * The "Anwesenheit" tab (spec §3): the day list with stamping in and out, absences, announced pickup persons, the meal
 * ticks and the info column, or the month table. Every child viewer may change everything of the children of their own
 * group (or without group), also on older days; for a child of another group (`own` false, group book spec §3.4) only
 * "Kommt", "Geht" and "Abholer ankündigen" are offered, the rest is shown read only, and its name opens the record only
 * when that group may be read. The printouts are for Leitung and Träger off the tablet. Nothing here asks the server on
 * a timer (only the overdue marker follows a local clock), so the tablet's lock time runs.
 *
 * Every child is one compact row (status, planned pickup, the meals counted, small markers, the contact ban always in
 * red) with "Kommt" or "Geht" on its right; tapping the row opens everything else below it (several rows may be open,
 * for this page view only). The group headings close and open their children, remembered per device.
 *
 * On top only one compact bar (Tag/Monat, the day, and one summary line „Da 12 · Noch nicht da 3 · … · Mittagessen
 * 10“); tapping the line opens the full counts and the meal box, remembered per device. The children follow at once.
 */
const { rights, onTablet } = useChildRights()
const canPrint = computed(() => !!rights.value?.isManager && !onTablet.value)
const s = de.attendance

const view = ref<'day' | 'month'>('day')
const date = ref<IsoDate>(todayIso())
const { data, error, refresh } = await useFetch<AttendanceDayDto>('/api/attendance/day', { query: { date }, key: 'attendance-day' })
const run = useAction(refresh)

const pickDate = computed({
  get: () => date.value,
  set: (value: string) => {
    if (isValidIsoDate(value)) date.value = value
  },
})
const dayText = (iso: IsoDate) => `${de.weekdaysShort[weekday(iso)]}, ${formatDate(iso)}`
function openDay(iso: IsoDate) {
  date.value = iso
  view.value = 'day'
}

const sections = computed(() => (data.value?.groups ?? []).map(group => ({
  key: group.id === null ? 'none' : String(group.id),
  name: group.id === null ? s.noGroup : group.name,
  rows: (data.value?.children ?? []).filter(child => child.groupId === group.id),
})))

// Rows opened by tapping (several at once, kept for this page view only, also across days).
const openRows = reactive(new Set<number>())
function toggleRow(child: AttendanceChildDto) {
  if (openRows.has(child.childId)) openRows.delete(child.childId)
  else openRows.add(child.childId)
}

// Closed group headings, remembered per device; read after mounting so the server's page (all open) matches.
const closedGroups = ref<string[]>([])
onMounted(() => (closedGroups.value = readClosedAttendanceGroups()))
function toggleGroup(key: string) {
  closedGroups.value = closedGroups.value.includes(key) ? closedGroups.value.filter(entry => entry !== key) : [...closedGroups.value, key]
  writeClosedAttendanceGroups(closedGroups.value)
}
const isClosed = (key: string) => closedGroups.value.includes(key)

// The summary line on top; the counts and the meal box below it open on a tap, remembered per device (read after
// mounting, so the server's page, closed, matches).
const summaryOpen = ref(false)
onMounted(() => (summaryOpen.value = readAttendanceSummaryOpen()))
function toggleSummary() {
  summaryOpen.value = !summaryOpen.value
  writeAttendanceSummaryOpen(summaryOpen.value)
}
const summaryParts = computed(() => (data.value ? attendanceSummaryParts(data.value.counts, data.value.meals) : []))
/** The groups as listed: a closed one keeps its overdue children and warns on its heading (overdue count, contact ban). */
const shownSections = computed(() => sections.value.map(section => ({
  ...section,
  closed: isClosed(section.key),
  shown: visibleAttendanceRows(section.rows, isClosed(section.key), isOverdue),
  warnings: closedGroupWarnings(section.rows, isOverdue),
})))

/** The stays never closed on earlier days, one line per day ("Gestern nicht ausgestempelt: …"). */
const openStayDays = computed(() => {
  const days = new Map<IsoDate, string[]>()
  for (const stay of data.value?.openStays ?? []) days.set(stay.date, [...(days.get(stay.date) ?? []), stay.name])
  return [...days].map(([day, names]) => ({
    date: day,
    text: s.openStays(day === addDays(date.value, -1) ? s.yesterday : s.onDay(dayText(day)), names.join('; ')),
  }))
})

// Drafts of the fields edited in place (planned pickup, the day's note); a refresh keeps a draft with an unsaved edit.
interface Draft { plannedPickup: string; note: string }
const drafts = reactive<Record<number, Draft>>({})
const stored = new Map<number, Draft>()
const storedOf = (child: AttendanceChildDto): Draft => ({
  plannedPickup: child.plannedPickup === null ? '' : formatTime(child.plannedPickup), note: child.note,
})
watch(data, (value) => {
  for (const child of value?.children ?? []) {
    const next = storedOf(child)
    const previous = stored.get(child.childId)
    const draft = drafts[child.childId]
    if (!draft) drafts[child.childId] = { ...next }
    else {
      if (draft.plannedPickup === previous?.plannedPickup) draft.plannedPickup = next.plannedPickup
      if (draft.note === previous?.note) draft.note = next.note
    }
    stored.set(child.childId, next)
  }
}, { immediate: true })
watch(date, () => {
  for (const key of Object.keys(drafts)) delete drafts[Number(key)]
  stored.clear()
})

const saving = reactive<Record<number, boolean>>({})
async function saveDay(child: AttendanceChildDto, body: Omit<AttendanceDayInput, 'childId' | 'date'>, revert: () => void) {
  const day = data.value?.date
  if (!day || saving[child.childId]) return
  saving[child.childId] = true
  const ok = await run(() => $fetch<unknown>('/api/attendance/day', { method: 'PUT', body: { childId: child.childId, date: day, ...body } }))
  saving[child.childId] = false
  if (!ok) revert()
}
function saveNote(child: AttendanceChildDto) {
  const draft = drafts[child.childId]
  const before = stored.get(child.childId)?.note ?? ''
  if (!draft || draft.note.trim() === before) return
  saveDay(child, { note: draft.note }, () => (draft.note = before))
}
function savePlannedPickup(child: AttendanceChildDto) {
  const draft = drafts[child.childId]
  const before = stored.get(child.childId)?.plannedPickup ?? ''
  if (!draft || draft.plannedPickup.trim() === before) return
  const minutes = parseClock(draft.plannedPickup)
  // The planned pickup cannot be removed, only changed; an unreadable time puts the stored one back.
  if (minutes === null || formatTime(minutes) === before) {
    draft.plannedPickup = before
    return
  }
  saveDay(child, { plannedPickup: minutes }, () => (draft.plannedPickup = before))
}
/** A tick overrides the automatic count for the day; `null` hands the meal back to the automatic. */
function setMeal(child: AttendanceChildDto, mealId: number, value: boolean | null) {
  saveDay(child, { meals: { [mealId]: value } }, () => {})
}
const mealCounted = (child: AttendanceChildDto, mealId: number) => child.meals[mealId]?.counted ?? false
const mealManual = (child: AttendanceChildDto, mealId: number) => child.meals[mealId]?.manual ?? false
const blurOnEnter = (event: KeyboardEvent) => (event.target as HTMLElement).blur()

// One dialog at a time, for a child of the shown day (looked up again after every refresh).
type DialogKind = 'arrive' | 'leave' | 'absent' | 'announce' | 'stay' | 'history'
const dialog = ref<{ kind: DialogKind; childId: number; stayId?: number } | null>(null)
const dialogChild = computed(() => data.value?.children.find(child => child.childId === dialog.value?.childId) ?? null)
const openDialog = (kind: DialogKind, child: AttendanceChildDto, stayId?: number) => (dialog.value = { kind, childId: child.childId, stayId })
const dialogOpen = (kind: DialogKind) => computed({
  get: () => dialog.value?.kind === kind && dialogChild.value !== null,
  set: (value: boolean) => {
    if (!value && dialog.value?.kind === kind) dialog.value = null
  },
})
const arriveOpen = dialogOpen('arrive')
const leaveOpen = dialogOpen('leave')
const absentOpen = dialogOpen('absent')
const announceOpen = dialogOpen('announce')
const stayOpen = dialogOpen('stay')
const historyOpen = dialogOpen('history')
watch(date, () => (dialog.value = null))

// The overdue pickup (spec §3.6) follows the clock in the browser only: a tick every minute, never a request, so the
// tablet's lock time keeps running. Until the page is mounted (SSR) the server's value is shown.
const now = ref<Date | null>(null)
let clock: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  now.value = new Date()
  clock = setInterval(() => (now.value = new Date()), 60_000)
})
onBeforeUnmount(() => clearInterval(clock))
const berlinNow = computed(() => (now.value ? nowInBerlin(now.value) : null))
function isOverdue(child: AttendanceChildDto): boolean {
  const current = berlinNow.value
  if (!current || !data.value) return child.pickupOverdue
  return pickupOverdue(child.stays, child.plannedPickup, data.value.date === current.date, current.minutes)
}

/** A later day: stamping in and out is not possible there yet (absences and announced persons are). */
const isFutureDay = computed(() => !!data.value && data.value.date > (berlinNow.value?.date ?? todayIso()))

/** The row's colour (and its status text's), by status; red for an overdue pickup. */
const rowTone = (child: AttendanceChildDto) => attendanceRowTone(child, isOverdue(child))
const statusClass = (child: AttendanceChildDto) => ATTENDANCE_STATUS_CLASS[rowTone(child)]
const quickAction = (child: AttendanceChildDto) => attendanceQuickAction(child, isFutureDay.value)
const mealButton = (on: boolean) => (on ? 'bg-green-50 text-green-900 ring-green-400' : 'bg-white text-gray-600 ring-gray-300')
</script>

<template>
  <div class="space-y-2">
    <!-- One compact bar: Tag/Monat, the day and, on the day list, the summary line (tap it for the counts and meals). -->
    <div class="space-y-1 rounded-lg bg-white p-1.5 ring-1 ring-gray-200">
      <div class="flex flex-wrap items-center gap-1.5">
        <div class="inline-flex rounded-lg bg-gray-50 p-0.5 ring-1 ring-gray-200" role="group">
          <UButton
            v-for="entry in (['day', 'month'] as const)" :key="entry" size="lg" class="min-h-11" :aria-pressed="view === entry"
            :variant="view === entry ? 'solid' : 'ghost'" :color="view === entry ? 'primary' : 'neutral'"
            :label="entry === 'day' ? s.dayView : s.monthView" @click="view = entry"
          />
        </div>
        <template v-if="view === 'day'">
          <UButton
            size="lg" class="min-h-11 min-w-11 justify-center" icon="i-lucide-chevron-left" color="neutral" variant="outline" :aria-label="s.previousDay"
            @click="date = addDays(date, -1)"
          />
          <DateTextInput v-model="pickDate" size="lg" :label="s.dayView" :aria-label="s.dayView" :ui="{ base: 'min-h-11' }" class="w-44" />
          <UButton
            size="lg" class="min-h-11 min-w-11 justify-center" icon="i-lucide-chevron-right" color="neutral" variant="outline" :aria-label="s.nextDay"
            @click="date = addDays(date, 1)"
          />
          <UButton size="lg" class="min-h-11" color="neutral" variant="outline" :label="s.today" :disabled="date === todayIso()" @click="date = todayIso()" />
          <span class="px-1 text-base font-semibold">{{ dayText(date) }}</span>
          <UButton
            v-if="canPrint" class="ml-auto min-h-11" color="neutral" variant="outline" icon="i-lucide-printer" :label="s.print"
            :to="`/print/children/attendance/${date}`" target="_blank"
          />
        </template>
      </div>
      <button
        v-if="view === 'day' && data && !error" type="button"
        class="flex min-h-11 w-full items-center gap-2 rounded-md px-1.5 text-left text-base font-medium hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-primary"
        :aria-expanded="summaryOpen" aria-controls="attendance-summary-details" @click="toggleSummary"
      >
        <UIcon :name="summaryOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-5 shrink-0 text-gray-500" aria-hidden="true" />
        <span class="min-w-0 flex-1">{{ summaryParts.join(' · ') }}</span>
      </button>
    </div>

    <ChildrenAttendanceMonthTab v-if="view === 'month'" :initial="date" :can-print="canPrint" @open-day="openDay" />

    <template v-else>
      <p v-if="error" class="rounded-lg bg-white p-4 text-sm ring-1 ring-gray-200">{{ errorMessage(error) }}</p>
      <template v-else-if="data">
        <!-- Opened from the summary line: everything of the former counts box and the meal box. -->
        <div v-if="summaryOpen" id="attendance-summary-details" class="space-y-2">
          <p class="rounded-lg bg-white px-3 py-2 text-sm font-medium ring-1 ring-gray-200">{{ s.counts(data.counts) }}</p>
          <ChildrenAttendanceMealSummary :day="data" />
        </div>
        <p v-if="!data.isCareDay" class="rounded-md bg-gray-100 px-2 py-1 text-sm text-gray-700">{{ s.noCareDay }}</p>
        <!-- Stays not closed on earlier days: one slim line each, still with „Zum Tag“. -->
        <div
          v-for="entry in openStayDays" :key="entry.date"
          class="flex items-center gap-2 rounded-md bg-amber-50 pl-2 text-sm text-amber-900 ring-1 ring-amber-300" role="status"
        >
          <UIcon name="i-lucide-clock-alert" class="size-4 shrink-0" aria-hidden="true" />
          <span class="min-w-0 flex-1 py-1">{{ entry.text }}</span>
          <UButton
            size="md" class="min-h-11 shrink-0" color="warning" variant="ghost" trailing-icon="i-lucide-arrow-right" :label="s.goToDay"
            @click="date = entry.date"
          />
        </div>

        <p v-if="!sections.length" class="text-sm text-gray-500">{{ s.noChildren }}</p>
        <section v-for="section in shownSections" :key="section.key" class="space-y-1">
          <h2>
            <button
              type="button"
              class="flex min-h-11 w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-1 text-left text-sm font-semibold uppercase tracking-wide text-gray-600 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-primary"
              :aria-expanded="!section.closed" :aria-controls="`attendance-group-${section.key}`" @click="toggleGroup(section.key)"
            >
              <UIcon :name="section.closed ? 'i-lucide-chevron-right' : 'i-lucide-chevron-down'" class="size-5 shrink-0" aria-hidden="true" />
              <span>{{ section.name }}</span>
              <span class="font-normal normal-case tracking-normal text-gray-500">· {{ s.row.children(section.rows.length) }}</span>
              <!-- A closed group still warns: its overdue children stay listed below, and a contact ban shows here. -->
              <template v-if="section.closed">
                <span
                  v-if="section.warnings.overdue"
                  class="inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 normal-case tracking-normal text-red-800 ring-1 ring-red-300"
                >
                  <UIcon name="i-lucide-alarm-clock" class="size-4" aria-hidden="true" />{{ s.row.overdue(section.warnings.overdue) }}
                </span>
                <span
                  v-if="section.warnings.contactBan"
                  class="inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 normal-case tracking-normal text-red-800 ring-1 ring-red-300"
                >
                  <UIcon name="i-lucide-ban" class="size-4" aria-hidden="true" />{{ s.row.contactBan }}
                </span>
              </template>
            </button>
          </h2>
          <ul
            v-if="section.shown.length" :id="`attendance-group-${section.key}`"
            class="divide-y divide-gray-200 overflow-hidden rounded-lg bg-white ring-1 ring-gray-200"
          >
            <li v-for="child in section.shown" :key="child.childId" class="border-l-4" :class="ATTENDANCE_ROW_CLASS[rowTone(child)]">
              <!-- The compact row: tapping it opens the rest; "Kommt" or "Geht" works without opening. -->
              <div class="flex items-center gap-2 px-2 py-1.5">
                <button
                  type="button"
                  class="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-1 text-left focus-visible:outline-2 focus-visible:outline-primary"
                  :aria-expanded="openRows.has(child.childId)" :aria-controls="`attendance-row-${child.childId}`" @click="toggleRow(child)"
                >
                  <UIcon
                    :name="openRows.has(child.childId) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-5 shrink-0 text-gray-500"
                    aria-hidden="true"
                  />
                  <span class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span class="text-base font-medium">{{ child.name }}</span>
                    <span class="font-medium" :class="statusClass(child)">· {{ compactStatusText(child) }}</span>
                    <span v-if="child.plannedPickup !== null" class="text-sm text-gray-700">· {{ s.plannedPickup }} {{ formatTime(child.plannedPickup) }}</span>
                    <span v-if="countedMealNames(child, data.meals).length" class="inline-flex flex-wrap items-center gap-x-2 text-sm text-green-800">
                      <span class="sr-only">{{ s.row.meals }}:</span>
                      <span v-for="name in countedMealNames(child, data.meals)" :key="name" class="inline-flex items-center gap-0.5">
                        <UIcon name="i-lucide-check" class="size-4" aria-hidden="true" />{{ name }}
                      </span>
                    </span>
                    <span
                      v-if="child.hasContactBan"
                      class="inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-sm font-semibold text-red-800 ring-1 ring-red-300"
                    >
                      <UIcon name="i-lucide-ban" class="size-4" aria-hidden="true" />{{ s.row.contactBan }}
                    </span>
                    <span v-if="child.allergies" class="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">
                      <UIcon name="i-lucide-triangle-alert" class="size-3.5" aria-hidden="true" />{{ s.row.allergy }}
                    </span>
                    <span
                      v-if="child.insectRepellent === false"
                      class="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900"
                    >
                      <UIcon name="i-lucide-bug-off" class="size-3.5" aria-hidden="true" />{{ s.noInsectRepellent }}
                    </span>
                    <span v-if="child.note" class="inline-flex items-center text-gray-600" :title="s.row.note">
                      <UIcon name="i-lucide-notebook-pen" class="size-4" aria-hidden="true" /><span class="sr-only">{{ s.row.note }}</span>
                    </span>
                    <span v-if="child.changed" class="inline-flex items-center text-gray-600" :title="s.changed">
                      <UIcon name="i-lucide-history" class="size-4" aria-hidden="true" /><span class="sr-only">{{ s.row.changed }}</span>
                    </span>
                  </span>
                </button>
                <UButton
                  v-if="quickAction(child) === 'arrive'" size="xl" color="success" icon="i-lucide-log-in" :label="s.actions.arrive" class="min-h-11 shrink-0"
                  @click="openDialog('arrive', child)"
                />
                <UButton
                  v-else-if="quickAction(child) === 'leave'" size="xl" icon="i-lucide-log-out" :label="s.actions.leave" class="min-h-11 shrink-0"
                  @click="openDialog('leave', child)"
                />
              </div>
              <p
                v-if="isOverdue(child) && child.plannedPickup !== null" class="flex items-center gap-1 px-3 pb-2 font-semibold text-red-700" role="alert"
              >
                <UIcon name="i-lucide-alarm-clock" class="size-4" />{{ s.pickupOverdue(formatTime(child.plannedPickup)) }}
              </p>

              <!-- Opened: everything of the day (Kommt and Geht stay in the row above). -->
              <div
                v-if="openRows.has(child.childId)" :id="`attendance-row-${child.childId}`"
                class="grid gap-3 border-t border-gray-200 bg-white p-3 lg:grid-cols-[minmax(0,15rem)_auto_minmax(0,1fr)_auto] lg:items-start"
              >
                <!-- Name and status -->
                <div class="min-w-0 space-y-0.5">
                  <div class="flex items-center gap-1">
                    <NuxtLink
                      v-if="child.recordReadable" :to="`/children/${child.childId}`" class="truncate text-base font-medium text-sky-700 hover:underline"
                    >
                      {{ child.name }}
                    </NuxtLink>
                    <span v-else class="truncate text-base font-medium">{{ child.name }}</span>
                    <UButton
                      v-if="child.changed" size="lg" class="min-h-11 min-w-11 justify-center" color="neutral" variant="ghost" icon="i-lucide-history"
                      :aria-label="s.changed" :title="s.changed"
                      @click="openDialog('history', child)"
                    />
                  </div>
                  <p class="font-medium" :class="statusClass(child)">{{ attendanceStatusText(child) }}</p>
                  <p v-if="child.announcements.length" class="text-sm text-sky-800">{{ s.pickupToday(child.announcements.map(entry => entry.name).join(', ')) }}</p>
                  <p v-if="data.recordBroughtBy && child.broughtBy" class="text-sm text-gray-600">{{ s.broughtByShort(child.broughtBy) }}</p>
                  <div v-if="child.stays.length" class="flex flex-wrap gap-1 pt-1">
                    <div v-for="stay in child.stays" :key="stay.id" class="space-y-0.5">
                      <UButton
                        v-if="child.own" size="md" color="neutral" variant="soft" icon="i-lucide-pencil" :label="stayText(stay)"
                        :aria-label="[`${s.editStay}: ${stayText(stay)}`, confirmedWithText(stay)].filter(Boolean).join(', ')"
                        @click="openDialog('stay', child, stay.id)"
                      />
                      <!-- Another group's child: the times are shown, corrections are for its own group. -->
                      <p v-else class="rounded-md bg-gray-100 px-2 py-1 text-sm text-gray-700">{{ stayText(stay) }}</p>
                      <!-- "Rücksprache mit" of a person typed by hand, readable on the tablet too. -->
                      <p v-if="confirmedWithText(stay)" class="px-1 text-xs text-gray-600" aria-hidden="true">{{ confirmedWithText(stay) }}</p>
                    </div>
                  </div>
                </div>

                <!-- Planned pickup and meals -->
                <!-- Another group's child: planned pickup and meals as text (the own group changes them). -->
                <div v-if="!child.own" class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-700">
                  <span v-if="child.plannedPickup !== null">{{ s.plannedPickup }}: {{ formatTime(child.plannedPickup) }}</span>
                  <span v-for="meal in data.meals" :key="meal.mealId" class="inline-flex items-center gap-1">
                    <UIcon :name="mealCounted(child, meal.mealId) ? 'i-lucide-square-check' : 'i-lucide-square'" class="size-4" aria-hidden="true" />
                    {{ meal.name }}<span class="sr-only">: {{ mealCounted(child, meal.mealId) ? s.history.yes : s.history.no }}</span>
                  </span>
                </div>
                <div v-else class="flex flex-wrap items-end gap-2">
                  <UFormField v-if="drafts[child.childId] && (child.stays.length || child.plannedPickup !== null)" :label="s.plannedPickup">
                    <TimeInput
                      v-model="drafts[child.childId]!.plannedPickup" any-minute size="lg" class="w-24" :aria-label="s.plannedPickupLabel"
                      :disabled="saving[child.childId]" @blur="savePlannedPickup(child)" @keydown.enter="blurOnEnter"
                    />
                  </UFormField>
                  <div v-for="meal in data.meals" :key="meal.mealId" class="flex items-center">
                    <button
                      type="button" class="flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm ring-1" :class="mealButton(mealCounted(child, meal.mealId))"
                      :aria-pressed="mealCounted(child, meal.mealId)" :disabled="saving[child.childId]"
                      @click="setMeal(child, meal.mealId, !mealCounted(child, meal.mealId))"
                    >
                      <UIcon :name="mealCounted(child, meal.mealId) ? 'i-lucide-square-check' : 'i-lucide-square'" class="size-5" />
                      {{ meal.name }}
                      <span v-if="mealManual(child, meal.mealId)" class="text-xs text-gray-500">({{ s.manual }})</span>
                    </button>
                    <UButton
                      v-if="mealManual(child, meal.mealId)" size="lg" class="min-h-11 min-w-11 justify-center" color="neutral"
                      variant="ghost" icon="i-lucide-rotate-ccw"
                      :aria-label="`${meal.name}: ${s.resetMeal}`" :title="s.resetMeal" :disabled="saving[child.childId]" @click="setMeal(child, meal.mealId, null)"
                    />
                  </div>
                </div>

                <!-- Info column: allergies from the record, then the day's note -->
                <div class="min-w-0 space-y-1">
                  <p v-if="child.allergies" class="flex items-start gap-1 rounded bg-amber-50 px-2 py-1 text-sm text-amber-900">
                    <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-4 shrink-0" /><span class="whitespace-pre-line break-words">{{ s.allergies }}: {{ child.allergies }}</span>
                  </p>
                  <p v-if="child.insectRepellent === false" class="flex items-start gap-1 rounded bg-amber-50 px-2 py-1 text-sm text-amber-900">
                    <UIcon name="i-lucide-bug-off" class="mt-0.5 size-4 shrink-0" /><span>{{ s.noInsectRepellent }}</span>
                  </p>
                  <template v-if="!child.own">
                    <p v-if="child.note" class="whitespace-pre-line break-words text-sm text-gray-700">{{ child.note }}</p>
                  </template>
                  <UTextarea
                    v-else-if="drafts[child.childId]" v-model="drafts[child.childId]!.note" :rows="1" autoresize maxlength="2000" class="w-full"
                    :placeholder="s.notePlaceholder" :aria-label="`${s.note}: ${child.name}`" :disabled="saving[child.childId]" @blur="saveNote(child)"
                  />
                </div>

                <!-- The other actions (Kommt and Geht are in the row) -->
                <div class="flex flex-wrap gap-2 lg:max-w-80 lg:justify-end">
                  <UButton
                    v-if="child.own && !child.stays.length" size="xl" color="neutral" variant="outline" icon="i-lucide-calendar-x" :label="s.actions.absent"
                    @click="openDialog('absent', child)"
                  />
                  <UButton size="xl" color="neutral" variant="outline" icon="i-lucide-user-plus" :label="s.actions.announce" @click="openDialog('announce', child)" />
                </div>
              </div>
            </li>
          </ul>
        </section>

        <template v-if="dialogChild">
          <ChildrenAttendanceArriveDialog
            v-model:open="arriveOpen" :child="dialogChild" :date="data.date" :record-brought-by="data.recordBroughtBy" :reload="refresh"
          />
          <ChildrenAttendanceLeaveDialog
            v-model:open="leaveOpen" :child="dialogChild" :date="data.date" :reload="refresh" @announce="openDialog('announce', dialogChild)"
          />
          <ChildrenAttendanceAbsenceDialog v-model:open="absentOpen" :child="dialogChild" :date="data.date" :reload="refresh" />
          <ChildrenAttendanceAnnounceDialog v-model:open="announceOpen" :child="dialogChild" :date="data.date" :reload="refresh" />
          <ChildrenAttendanceStayDialog
            v-if="dialog?.stayId !== undefined" v-model:open="stayOpen" :child="dialogChild" :stay-id="dialog.stayId" :date="data.date"
            :record-brought-by="data.recordBroughtBy" :reload="refresh"
          />
          <ChildrenAttendanceHistoryDialog v-model:open="historyOpen" :child-id="dialogChild.childId" :name="dialogChild.name" :date="data.date" />
        </template>
      </template>
    </template>
  </div>
</template>
