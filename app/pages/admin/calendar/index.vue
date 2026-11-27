<script setup lang="ts">
import { eventLastDay } from '#shared/domain/calendarEvents'
import { parseIsoDate, todayIso, weekday } from '#shared/domain/dates'
import type { CalendarEventDto, CalendarEventSaveDto, YearCalendarDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { absenceDates } from '~/utils/calendarKinds'
import { eventListDateText, eventListTimeText, eventVisibilityText } from '~/utils/calendarLanes'
import { calendarPrintItems } from '~/utils/calendarPrint'
import { SHOW_REQUESTS_KEY, requestCells, requestText, showRequestsFrom } from '~/utils/calendarRequests'
import { formatDateTime, formatDayShort } from '~/utils/format'
import { calendarTabs } from '~/utils/areaTabs'

/**
 * Admin-only year calendar. Entries are made by clicking: an employee day enters Urlaub/ÜF/Krank/Fortbildung/Schule
 * into the plan (workdays only, up to a chosen date); the appointments row adds or edits the admin's appointments.
 */
const route = useRoute()
const year = ref(Number(route.query.year) || parseIsoDate(todayIso()).year)
const { data: calendar, refresh } = await useFetch<YearCalendarDto>('/api/calendar', { query: { year } })
const run = useAction(refresh)
const confirm = useConfirm()
const toast = useToast()

/** „Wer sieht ihn?“ of the list, with the names of the chosen groups / people. */
const visibilityOf = (event: CalendarEventDto) => eventVisibilityText(event, calendar.value)

/**
 * The group the print button opens ("all": every group one after another, "none": the people without a group). A
 * choice the shown year does not have (nobody in that group) falls back to "all", visibly in the select too.
 */
const printPick = ref('all')
const printGroupItems = computed(() => (calendar.value ? calendarPrintItems(calendar.value, de.calendar.printAllGroups, de.calendar.printNoGroup) : []))
const printGroup = computed({
  get: () => (printGroupItems.value.some(item => item.value === printPick.value) ? printPick.value : 'all'),
  set: (value) => { printPick.value = value },
})

// --- open leave requests (Leitung, Träger, leave planners: the server sends them only to them) ---------------
/** „Anträge zeigen“: on by default, remembered on this device. */
const showRequests = ref(true)
onMounted(() => {
  try {
    showRequests.value = showRequestsFrom(localStorage.getItem(SHOW_REQUESTS_KEY))
  }
  catch { /* no storage: keep the default */ }
})
watch(showRequests, (value) => {
  try {
    localStorage.setItem(SHOW_REQUESTS_KEY, String(value))
  }
  catch { /* no storage */ }
})
const shownRequests = computed(() => (showRequests.value ? calendar.value?.requests ?? null : null))
const planningLink = computed(() => `/admin/leave-planning?year=${year.value}&tab=all`)

// --- absences -------------------------------------------------------------------------------------------
const absence = reactive({ open: false, employeeId: 0, date: '' })
const absenceTitle = computed(() => {
  const name = calendar.value?.employees.find(employee => employee.id === absence.employeeId)?.name ?? ''
  return absence.date ? `${name} · ${formatDayShort(absence.date, weekday(absence.date))}${absence.date.slice(0, 4)}` : name
})
/** Kinds the calendar can remove again (Feiertag/Schließtag stay; they come from holidays and closures). */
const REMOVABLE = ['sick', 'maternity', 'vacation', 'overtime_off', 'special_leave', 'training']
const hasAbsence = computed(() => REMOVABLE.includes(calendar.value?.days[absence.employeeId]?.[absence.date] ?? ''))
/** The open request on the clicked day (shown in the dialog with the way to the leave planning). */
const absenceRequest = computed(() => requestCells(shownRequests.value?.requests ?? []).get(absence.employeeId)?.get(absence.date))

function openAbsence(employeeId: number, date: string) {
  Object.assign(absence, { open: true, employeeId, date })
}

/**
 * Working days of that employee: Mon–Fri without public holidays and without their contractual days off; „abwesend“
 * and a full Elternzeit are left as they are (absenceDates).
 */
function workdays(employeeId: number, from: string, to: string): string[] {
  return absenceDates(calendar.value, employeeId, from, to)
}

async function applyAbsence(codeId: number | null, until: string) {
  const data = calendar.value
  if (!data) return
  const employeeId = absence.employeeId
  if (until < absence.date) {
    toast.add({ title: de.calendar.untilBeforeStart, color: 'error' })
    return
  }
  const dates = workdays(employeeId, absence.date, until)
  let body
  if (codeId === null) {
    const removable = dates.filter(date => REMOVABLE.includes(data.days[employeeId]?.[date] ?? ''))
    if (!removable.length) return
    // E.g. half a day ÜF next to a duty: removing clears the whole day, so ask first.
    const withOthers = removable.filter(date => data.otherEntries[employeeId]?.includes(date)).length
    if (withOthers && !await confirm(de.calendar.removeConfirm(withOthers))) return
    body ={ cells: removable.map(date => ({ employeeId, date })), mode: 'clear', entry: null }
  }
  else {
    if (!dates.length) {
      toast.add({ title: de.calendar.noWorkdays, color: 'warning' })
      return
    }
    const replaced = dates.filter(date => data.otherEntries[employeeId]?.includes(date)).length
    if (replaced && !await confirm(de.calendar.replaceConfirm(replaced), { danger: false })) return
    body = { cells: dates.map(date => ({ employeeId, date })), mode: 'replace', entry: { kind: 'code', codeId } }
  }
  if (await run(() => $fetch<unknown>('/api/entries', { method: 'POST', body }), de.common.saved)) absence.open = false
}

// --- appointments ---------------------------------------------------------------------------------------
const eventDialog = reactive<{ open: boolean; event: CalendarEventDto | null; date: string }>({ open: false, event: null, date: '' })

function openNewEvent(date: string) {
  Object.assign(eventDialog, { open: true, event: null, date })
}

function openEvent(event: CalendarEventDto) {
  Object.assign(eventDialog, { open: true, event, date: event.date })
}

async function saveEvent(value: CalendarEventSaveDto) {
  const event = eventDialog.event
  const ok = await run(() => event
    ? $fetch<unknown>(`/api/calendar-events/${event.id}`, { method: 'PUT', body: value })
    : $fetch<unknown>('/api/calendar-events', { method: 'POST', body: value }), de.common.saved)
  if (ok) {
    eventDialog.open = false
    year.value = parseIsoDate(value.date).year
  }
}

async function removeEvent(event: CalendarEventDto) {
  if (!await confirm(event.requirement ? de.eventRequirements.deleteConfirm : de.calendar.confirmDelete)) return
  if (await run(() => $fetch<unknown>(`/api/calendar-events/${event.id}`, { method: 'DELETE' }), de.common.deleted)) eventDialog.open = false
}
// The tabs of the page (a former menu entry each).
const { can: canTab } = useCan()

// --- „Teilnahme bestätigen“ of a Pflichttermin (also opened from „Offen für dich“: ?attendance=<id>) -----------
const mayConfirm = computed(() => canTab('employees.edit'))
const attendance = reactive<{ open: boolean; eventId: number | null }>({ open: false, eventId: null })
function openAttendance(eventId: number) {
  eventDialog.open = false
  Object.assign(attendance, { open: true, eventId })
}
/** From its last day on (the button; the server checks it as well). */
const confirmable = (event: CalendarEventDto) => !!event.requirement && mayConfirm.value && eventLastDay(event) <= todayIso()
onMounted(() => {
  const id = Number(route.query.attendance)
  if (Number.isInteger(id) && id > 0 && mayConfirm.value) openAttendance(id)
})
async function attendanceSaved() {
  await refresh()
  // Leaves „Offen für dich“ up to date (it reloads on a route change).
  if (route.query.attendance) await navigateTo({ query: { ...route.query, attendance: undefined } }, { replace: true })
}
</script>

<template>
  <div class="space-y-4">
    <AreaTabs :tabs="calendarTabs(canTab)" />
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-2xl font-semibold">{{ de.calendar.title }}</h1>
      <YearNav v-model="year" />
      <!-- What the printout shows: all groups one after another (each on its own pages) or one group. -->
      <USelect
        v-if="calendar?.groups.length" v-model="printGroup" :items="printGroupItems" class="ml-auto w-56"
        :aria-label="de.calendar.printGroupLabel"
      />
      <UButton
        :class="calendar?.groups.length ? '' : 'ml-auto'" color="neutral" variant="outline" icon="i-lucide-printer" :label="de.year.print"
        :to="`/admin/print/calendar/${year}${printGroup === 'all' ? '' : `?group=${printGroup}`}`" target="_blank"
      />
    </div>
    <p class="text-sm text-gray-500">{{ de.year.adminOnly }} {{ de.calendar.clickHint }}</p>
    <div v-if="calendar?.requests" class="flex flex-wrap items-center gap-x-4 gap-y-1">
      <USwitch v-model="showRequests" :label="de.calendar.showRequests" />
      <NuxtLink v-if="calendar.requests.canPlan" :to="planningLink" class="text-sm text-sky-700 hover:underline">{{ de.calendar.toPlanning }}</NuxtLink>
      <span v-if="showRequests" class="text-xs text-gray-500">{{ de.calendar.requestsHint }}</span>
    </div>
    <CalendarLegend :requests="!!shownRequests" :days="calendar?.days" />
    <CalendarGroupLegend v-if="calendar" :groups="calendar.groups" />

    <div v-if="calendar" class="space-y-3 overflow-x-auto">
      <div v-for="month in 12" :key="month" class="min-w-[900px] rounded-lg bg-white">
        <CalendarMonth
          :calendar="calendar" :month="month" editable :requests="shownRequests"
          @day-click="openAbsence" @event-day-click="openNewEvent" @event-click="openEvent"
        />
      </div>
    </div>

    <section class="max-w-4xl space-y-3">
      <h2 class="text-lg font-semibold">{{ de.calendar.eventList }}</h2>
      <p v-if="!calendar?.events.length" class="text-sm text-gray-500">{{ de.calendar.noEvents }}</p>
      <table v-else class="w-full overflow-hidden rounded-lg bg-white text-sm ring-1 ring-gray-200">
        <thead class="bg-gray-100 text-left text-xs text-gray-600">
          <tr>
            <th class="px-3 py-2">{{ de.calendar.date }}</th><th class="px-3 py-2">{{ de.calendar.time }}</th>
            <th class="px-3 py-2">{{ de.calendar.title2 }}</th><th class="px-3 py-2">{{ de.calendar.staffColumn }}</th><th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="event in calendar.events" :key="event.id" class="border-t border-gray-100">
            <td class="whitespace-nowrap px-3 py-2">{{ eventListDateText(event) }}</td>
            <td class="whitespace-nowrap px-3 py-2">{{ eventListTimeText(event) }}</td>
            <td class="px-3 py-2">
              {{ event.title }}
              <span v-if="event.requirement" class="mt-0.5 flex flex-wrap items-center gap-1">
                <UBadge size="sm" variant="soft" color="warning" :label="de.eventRequirements.badge(event.requirement.typeName)" />
                <span v-if="event.requirement.confirmedAt" class="text-xs text-green-700">
                  {{ de.eventRequirements.confirmedOn(formatDateTime(event.requirement.confirmedAt)) }}
                </span>
                <span v-else-if="eventLastDay(event) <= todayIso()" class="text-xs text-amber-800">{{ de.eventRequirements.unconfirmed }}</span>
              </span>
            </td>
            <td class="px-3 py-2">{{ visibilityOf(event) }}</td>
            <td class="whitespace-nowrap px-3 py-2 text-right">
              <UButton
                v-if="confirmable(event)" size="xs" color="primary" variant="ghost" icon="i-lucide-user-check"
                :label="de.eventRequirements.confirm" @click="openAttendance(event.id)"
              />
              <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" :aria-label="de.common.edit" @click="openEvent(event)" />
              <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" @click="removeEvent(event)" />
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <CalendarAbsenceDialog
      v-model:open="absence.open" :title="absenceTitle" :date="absence.date" :codes="calendar?.absenceCodes ?? []"
      :has-absence="hasAbsence" @apply="applyAbsence"
    >
      <div v-if="absenceRequest" class="space-y-1 rounded-md bg-green-50 p-2 text-sm ring-1 ring-green-200">
        <p>{{ requestText(absenceRequest) }}</p>
        <NuxtLink v-if="calendar?.requests?.canPlan" :to="planningLink" class="text-sky-700 hover:underline">{{ de.calendar.toPlanning }}</NuxtLink>
      </div>
    </CalendarAbsenceDialog>
    <CalendarEventDialog
      v-model:open="eventDialog.open" :event="eventDialog.event" :date="eventDialog.date"
      @save="saveEvent" @remove="eventDialog.event && removeEvent(eventDialog.event)"
      @attendance="eventDialog.event && openAttendance(eventDialog.event.id)"
    />
    <CalendarEventAttendanceDialog v-model:open="attendance.open" :event-id="attendance.eventId" @saved="attendanceSaved" />
  </div>
</template>
