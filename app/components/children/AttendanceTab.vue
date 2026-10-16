<script setup lang="ts">
import { addDays, isValidIsoDate, todayIso, weekday } from '#shared/domain/dates'
import { formatTime } from '#shared/domain/time'
import type { IsoDate } from '#shared/domain/types'
import type { AttendanceChildDto, AttendanceDayDto, AttendanceDayInput } from '#shared/types/api'
import { de } from '~/locales/de'
import { attendanceStatusText, parseClock, stayText } from '~/utils/attendance'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'

/**
 * The "Anwesenheit" tab (spec §3): the day list with stamping in and out, absences, announced pickup persons, the meal
 * ticks and the info column, or the month table. Every child viewer may change everything, also on older days; the
 * printouts are for Leitung and Träger off the tablet. Nothing here refreshes on a timer, so the tablet's lock time runs.
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
  key: group.id ?? 'none',
  name: group.id === null ? s.noGroup : group.name,
  rows: (data.value?.children ?? []).filter(child => child.groupId === group.id),
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
function setMeal(child: AttendanceChildDto, meal: 'snack' | 'lunch', value: boolean | null) {
  saveDay(child, { [meal]: value }, () => {})
}
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

const isAbsent = (child: AttendanceChildDto) => !['not_yet', 'present', 'gone'].includes(child.status)
const statusClass = (child: AttendanceChildDto) => ({
  'text-green-700': child.status === 'present',
  'text-gray-600': child.status === 'gone' || child.status === 'not_yet',
  'text-amber-700': isAbsent(child),
})
const mealButton = (on: boolean) => (on ? 'bg-green-50 text-green-900 ring-green-400' : 'bg-white text-gray-600 ring-gray-300')
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <div class="inline-flex rounded-lg bg-white p-0.5 ring-1 ring-gray-200" role="group">
        <UButton
          v-for="entry in (['day', 'month'] as const)" :key="entry" size="lg" :aria-pressed="view === entry"
          :variant="view === entry ? 'solid' : 'ghost'" :color="view === entry ? 'primary' : 'neutral'"
          :label="entry === 'day' ? s.dayView : s.monthView" @click="view = entry"
        />
      </div>
      <template v-if="view === 'day'">
        <UButton size="lg" icon="i-lucide-chevron-left" color="neutral" variant="outline" :aria-label="s.previousDay" @click="date = addDays(date, -1)" />
        <UInput v-model="pickDate" type="date" size="lg" :aria-label="s.dayView" />
        <UButton size="lg" icon="i-lucide-chevron-right" color="neutral" variant="outline" :aria-label="s.nextDay" @click="date = addDays(date, 1)" />
        <UButton size="lg" color="neutral" variant="outline" :label="s.today" :disabled="date === todayIso()" @click="date = todayIso()" />
        <span class="text-lg font-semibold">{{ dayText(date) }}</span>
        <UButton
          v-if="canPrint" class="ml-auto" color="neutral" variant="outline" icon="i-lucide-printer" :label="s.print"
          :to="`/print/children/attendance/${date}`" target="_blank"
        />
      </template>
    </div>

    <ChildrenAttendanceMonthTab v-if="view === 'month'" :initial="date" :can-print="canPrint" @open-day="openDay" />

    <template v-else>
      <p v-if="error" class="rounded-lg bg-white p-4 text-sm ring-1 ring-gray-200">{{ errorMessage(error) }}</p>
      <template v-else-if="data">
        <div class="rounded-lg bg-white p-3 ring-1 ring-gray-200">
          <p class="text-base font-medium">{{ s.counts(data.counts) }}</p>
          <p class="text-sm text-gray-600">{{ s.meals(formatTime(data.snackTime), data.counts.snack, formatTime(data.lunchTime), data.counts.lunch) }}</p>
        </div>
        <p v-if="!data.isCareDay" class="rounded-lg bg-gray-100 p-3 text-sm text-gray-700">{{ s.noCareDay }}</p>
        <div
          v-for="entry in openStayDays" :key="entry.date"
          class="flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 p-3 text-amber-900 ring-1 ring-amber-300" role="status"
        >
          <UIcon name="i-lucide-clock-alert" class="size-5 shrink-0" />
          <span class="flex-1">{{ entry.text }}</span>
          <UButton size="lg" color="warning" variant="outline" icon="i-lucide-arrow-right" :label="s.goToDay" @click="date = entry.date" />
        </div>

        <p v-if="!sections.length" class="text-sm text-gray-500">{{ s.noChildren }}</p>
        <section v-for="section in sections" :key="section.key" class="space-y-1">
          <h2 class="text-xs font-semibold uppercase tracking-wide text-gray-500">{{ section.name }}</h2>
          <ul class="divide-y divide-gray-200 overflow-hidden rounded-lg bg-white ring-1 ring-gray-200">
            <li
              v-for="child in section.rows" :key="child.childId"
              class="grid gap-3 p-3 lg:grid-cols-[minmax(0,15rem)_auto_minmax(0,1fr)_auto] lg:items-start"
              :class="child.pickupOverdue ? 'bg-red-50 ring-2 ring-inset ring-red-500' : ''"
            >
              <!-- Name and status -->
              <div class="min-w-0 space-y-0.5">
                <div class="flex items-center gap-1">
                  <NuxtLink :to="`/children/${child.childId}`" class="truncate text-base font-medium text-sky-700 hover:underline">{{ child.name }}</NuxtLink>
                  <UButton
                    v-if="child.changed" size="sm" color="neutral" variant="ghost" icon="i-lucide-history" :aria-label="s.changed" :title="s.changed"
                    @click="openDialog('history', child)"
                  />
                </div>
                <p class="font-medium" :class="statusClass(child)">{{ attendanceStatusText(child) }}</p>
                <p v-if="child.pickupOverdue && child.plannedPickup !== null" class="flex items-center gap-1 font-semibold text-red-700" role="alert">
                  <UIcon name="i-lucide-alarm-clock" class="size-4" />{{ s.pickupOverdue(formatTime(child.plannedPickup)) }}
                </p>
                <p v-if="child.announcements.length" class="text-sm text-sky-800">{{ s.pickupToday(child.announcements.map(entry => entry.name).join(', ')) }}</p>
                <p v-if="data.recordBroughtBy && child.broughtBy" class="text-sm text-gray-600">{{ s.broughtByShort(child.broughtBy) }}</p>
                <div v-if="child.stays.length" class="flex flex-wrap gap-1 pt-1">
                  <UButton
                    v-for="stay in child.stays" :key="stay.id" size="md" color="neutral" variant="soft" icon="i-lucide-pencil"
                    :label="stayText(stay)" :aria-label="`${s.editStay}: ${stayText(stay)}`" @click="openDialog('stay', child, stay.id)"
                  />
                </div>
              </div>

              <!-- Planned pickup and meals -->
              <div class="flex flex-wrap items-end gap-2">
                <UFormField v-if="drafts[child.childId] && (child.stays.length || child.plannedPickup !== null)" :label="s.plannedPickup">
                  <TimeInput
                    v-model="drafts[child.childId]!.plannedPickup" any-minute size="lg" class="w-24" :aria-label="s.plannedPickupLabel"
                    :disabled="saving[child.childId]" @blur="savePlannedPickup(child)" @keydown.enter="blurOnEnter"
                  />
                </UFormField>
                <div v-for="meal in (['snack', 'lunch'] as const)" :key="meal" class="flex items-center">
                  <button
                    type="button" class="flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm ring-1" :class="mealButton(child[meal])"
                    :aria-pressed="child[meal]" :disabled="saving[child.childId]" @click="setMeal(child, meal, !child[meal])"
                  >
                    <UIcon :name="child[meal] ? 'i-lucide-square-check' : 'i-lucide-square'" class="size-5" />
                    {{ s[meal] }}
                    <span v-if="meal === 'snack' ? child.snackManual : child.lunchManual" class="text-xs text-gray-500">({{ s.manual }})</span>
                  </button>
                  <UButton
                    v-if="meal === 'snack' ? child.snackManual : child.lunchManual" size="sm" color="neutral" variant="ghost" icon="i-lucide-rotate-ccw"
                    :aria-label="`${s[meal]}: ${s.resetMeal}`" :title="s.resetMeal" :disabled="saving[child.childId]" @click="setMeal(child, meal, null)"
                  />
                </div>
              </div>

              <!-- Info column: allergies from the record, then the day's note -->
              <div class="min-w-0 space-y-1">
                <p v-if="child.allergies" class="flex items-start gap-1 rounded bg-amber-50 px-2 py-1 text-sm text-amber-900">
                  <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-4 shrink-0" /><span class="whitespace-pre-line break-words">{{ s.allergies }}: {{ child.allergies }}</span>
                </p>
                <UTextarea
                  v-if="drafts[child.childId]" v-model="drafts[child.childId]!.note" :rows="1" autoresize maxlength="2000" class="w-full"
                  :placeholder="s.notePlaceholder" :aria-label="`${s.note}: ${child.name}`" :disabled="saving[child.childId]" @blur="saveNote(child)"
                />
              </div>

              <!-- Actions by status -->
              <div class="flex flex-wrap gap-2 lg:max-w-80 lg:justify-end">
                <UButton v-if="child.status !== 'present'" size="xl" color="success" icon="i-lucide-log-in" :label="s.actions.arrive" @click="openDialog('arrive', child)" />
                <UButton v-if="child.status === 'present'" size="xl" icon="i-lucide-log-out" :label="s.actions.leave" @click="openDialog('leave', child)" />
                <UButton
                  v-if="!child.stays.length" size="xl" color="neutral" variant="outline" icon="i-lucide-calendar-x" :label="s.actions.absent"
                  @click="openDialog('absent', child)"
                />
                <UButton size="xl" color="neutral" variant="outline" icon="i-lucide-user-plus" :label="s.actions.announce" @click="openDialog('announce', child)" />
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
