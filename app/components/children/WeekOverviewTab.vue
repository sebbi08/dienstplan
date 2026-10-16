<script setup lang="ts">
import { addDays, todayIso, weekStart } from '#shared/domain/dates'
import type { IsoDate } from '#shared/domain/types'
import type { GroupDayLabel, GroupWeekDto, NoteDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorCode, errorMessage } from '~/utils/errors'
import { formatDate, formatDateSpan, formatDateTime } from '~/utils/format'

/**
 * The "Wochenübersicht" tab (group book spec §2): per group and week the theme ("Wochenthema / geplant") and for Monday
 * to Friday "Was haben wir gemacht". Whoever has the group as their own writes, also in past weeks (saved when leaving a
 * field); a granted group is read only. Every field shows who changed it last and opens its history. Nothing here asks
 * the server on a timer, so the tablet's lock time runs. Printing is for Leitung and Träger off the tablet.
 */
const { rights, onTablet } = useChildRights()
const canPrint = computed(() => !!rights.value?.isManager && !onTablet.value)
const s = de.groupBook

/** Any day of the shown week. */
const date = ref<IsoDate>(todayIso())
/** The chosen group; null = the server's choice (the own group, else the first one the person sees). */
const groupId = ref<number | null>(null)
const query = computed(() => (groupId.value === null ? { date: date.value } : { groupId: groupId.value, date: date.value }))
const { data, error, status, refresh } = await useFetch<GroupWeekDto>('/api/group-book/week', { query, key: 'group-book-week' })
const run = useAction(refresh)

// A group that is no longer visible (the read access was taken away, the group deleted): back to the server's choice.
// Until that new request is answered, the old 404 is not shown as "no groups" ('waiting' for the request to start,
// 'loading' while it runs).
const fallback = ref<'none' | 'waiting' | 'loading'>('none')
watch(error, (value) => {
  if (value && errorCode(value) === 'group_not_found' && groupId.value !== null) {
    fallback.value = 'waiting'
    groupId.value = null
  }
})
watch(status, (value) => {
  if (value === 'pending' && fallback.value === 'waiting') fallback.value = 'loading'
  else if ((value === 'success' || value === 'error') && fallback.value === 'loading') fallback.value = 'none'
})
const noGroups = computed(() => fallback.value === 'none' && !!error.value && errorCode(error.value) === 'group_not_found' && groupId.value === null)

const selectedGroup = computed({
  get: () => data.value?.groupId,
  set: (value: number | undefined) => {
    if (value !== undefined) groupId.value = value
  },
})
const groupItems = computed(() => (data.value?.groups ?? []).map(group => ({
  label: group.right === 'read' ? s.readGroup(group.name) : group.name, value: group.id,
})))

// Today follows the clock for "Diese Woche" (the tablet stays open past midnight and over the weekend): read again when
// the page becomes visible, when the tab is shown again, whenever the week changes and once a minute for a screen that
// stays on. Only the device's clock is read, the server is not asked (the tablet's lock time keeps running).
const today = ref<IsoDate>(todayIso())
const updateToday = () => (today.value = todayIso())
const onVisibility = () => {
  if (document.visibilityState === 'visible') updateToday()
}
let clock: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  updateToday()
  document.addEventListener('visibilitychange', onVisibility)
  clock = setInterval(updateToday, 60_000)
})
onActivated(updateToday)
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibility)
  clearInterval(clock)
})
watch(date, updateToday)
const thisWeek = computed(() => weekStart(today.value))
const showThisWeek = () => {
  updateToday()
  date.value = today.value
}
const period = computed(() => (data.value ? s.period(data.value.weekNumber, formatDateSpan(data.value.days[0]!.date, data.value.days[4]!.date)) : ''))
const shiftWeek = (weeks: number) => (date.value = addDays(weekStart(date.value), weeks * 7))

/** One text field of the week: the theme or a day. */
interface Field {
  /** Group, week and field ("3|2026-10-19|week", "3|2026-10-19|2026-10-21"): drafts and saves never mix weeks or groups. */
  key: string
  field: 'week' | 'day'
  date: IsoDate
  title: string
  label: GroupDayLabel | null
  note: NoteDto
}
const fieldsOf = (week: GroupWeekDto): Field[] => [
  { key: `${week.groupId}|${week.weekStart}|week`, field: 'week', date: week.weekStart, title: s.theme, label: null, note: week.theme },
  ...week.days.map((day, index) => ({
    key: `${week.groupId}|${week.weekStart}|${day.date}`, field: 'day' as const, date: day.date, title: `${s.weekdays[index]}, ${formatDate(day.date)}`, label: day.label, note: day.note,
  })),
]
const fields = computed(() => (data.value ? fieldsOf(data.value) : []))

/** "Feiertag: Allerheiligen" / "Schließtag: <Bezeichnung>". */
function labelText(label: GroupDayLabel): string {
  return label.kind === 'holiday' ? s.holiday(de.holidays[label.key]) : s.closure(label.label)
}

// Drafts of the fields by group, week and field. They are kept for the whole visit of the tab: a refresh keeps an
// unsaved edit, and a text whose save failed after the person went on to another week or group is there again (still
// unsaved, with "Speichern") when they come back.
const drafts = reactive<Record<string, string>>({})
const stored = new Map<string, string>()
watch(data, (week) => {
  if (!week) return
  for (const field of fieldsOf(week)) {
    if (drafts[field.key] === undefined || drafts[field.key] === stored.get(field.key)) drafts[field.key] = field.note.text
    stored.set(field.key, field.note.text)
  }
}, { immediate: true })

/** The server says no for good (no write right any more, group gone, bad day): the typed text cannot be saved. */
const REFUSALS = ['group_read_only', 'group_not_found', 'invalid_date']

const dirty = (field: Field) => (drafts[field.key] ?? '').trim() !== (stored.get(field.key) ?? '')
const saving = reactive<Record<string, boolean>>({})
async function save(field: Field) {
  const week = data.value
  if (!week?.canWrite || !dirty(field) || saving[field.key]) return
  const text = (drafts[field.key] ?? '').trim()
  const before = stored.get(field.key) ?? ''
  saving[field.key] = true
  let refused = false
  const ok = await run(async () => {
    try {
      await (field.field === 'week'
        ? $fetch<unknown>('/api/group-book/week', { method: 'PUT', body: { groupId: week.groupId, weekStart: week.weekStart, text } })
        : $fetch<unknown>('/api/group-book/day', { method: 'PUT', body: { groupId: week.groupId, date: field.date, text } }))
    }
    catch (failure) {
      refused = REFUSALS.includes(errorCode(failure) ?? '')
      throw failure
    }
  }, de.common.saved)
  saving[field.key] = false
  if (ok || !refused) return
  // Refused: the stored text comes back, and the tab reloads to show the right as it is now (a group gone from view
  // falls back to the own group). On any other failure (no connection, timeout) the draft stays for another try.
  drafts[field.key] = before
  await refresh()
}

// The history of one field.
const history = ref<{ groupId: number; field: Field } | null>(null)
const historyOpen = computed({
  get: () => history.value !== null,
  set: (value: boolean) => {
    if (!value) history.value = null
  },
})
watch(query, () => (history.value = null))
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <UButton size="lg" icon="i-lucide-chevron-left" color="neutral" variant="outline" :aria-label="s.previousWeek" @click="shiftWeek(-1)" />
      <UButton size="lg" icon="i-lucide-chevron-right" color="neutral" variant="outline" :aria-label="s.nextWeek" @click="shiftWeek(1)" />
      <UButton size="lg" color="neutral" variant="outline" :label="s.thisWeek" :disabled="weekStart(date) === thisWeek" @click="showThisWeek" />
      <span class="text-lg font-semibold">{{ period }}</span>
      <USelect
        v-if="groupItems.length > 1" v-model="selectedGroup" :items="groupItems" size="lg" class="w-56" :aria-label="s.group"
      />
      <span v-else-if="data" class="text-lg text-gray-700">{{ data.groupName }}</span>
      <UButton
        v-if="canPrint && data" class="ml-auto" color="neutral" variant="outline" icon="i-lucide-printer" :label="s.print"
        :to="`/print/children/week/${data.groupId}/${data.weekStart}`" target="_blank"
      />
    </div>

    <p v-if="noGroups" class="rounded-lg bg-white p-4 text-sm ring-1 ring-gray-200">{{ s.noGroups }}</p>
    <p v-else-if="fallback !== 'none'" class="text-sm text-gray-500"><UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" /></p>
    <p v-else-if="error" class="rounded-lg bg-white p-4 text-sm ring-1 ring-gray-200">{{ errorMessage(error) }}</p>
    <template v-else-if="data">
      <p v-if="!data.canWrite" class="flex items-center gap-2 rounded-lg bg-gray-100 p-3 text-sm text-gray-700" role="status">
        <UIcon name="i-lucide-eye" class="size-5 shrink-0" />
        <span><span class="font-semibold">{{ s.readOnly }}:</span> {{ s.readOnlyHint }}</span>
      </p>

      <section
        v-for="field in fields" :key="field.key" class="space-y-1 rounded-lg p-3 ring-1"
        :class="field.label ? 'bg-gray-100 ring-gray-300' : 'bg-white ring-gray-200'"
      >
        <div class="flex flex-wrap items-baseline gap-x-3">
          <h2 class="font-semibold" :class="field.field === 'week' ? 'text-lg' : 'text-base'">{{ field.title }}</h2>
          <span v-if="field.field === 'day'" class="text-sm text-gray-500">{{ s.done }}</span>
          <span v-if="field.label" class="text-sm font-medium text-gray-600">{{ labelText(field.label) }}</span>
        </div>
        <template v-if="data.canWrite && drafts[field.key] !== undefined">
          <UTextarea
            v-model="drafts[field.key]" size="xl" :rows="field.field === 'week' ? 3 : 4" autoresize maxlength="5000" class="w-full"
            :placeholder="field.field === 'week' ? s.themePlaceholder : s.donePlaceholder" :aria-label="field.title"
            :disabled="saving[field.key]" @blur="save(field)"
          />
          <div v-if="dirty(field)" class="flex justify-end">
            <UButton size="lg" icon="i-lucide-check" :label="de.common.save" :loading="saving[field.key]" @click="save(field)" />
          </div>
        </template>
        <p v-else-if="field.note.text" class="whitespace-pre-line break-words">{{ field.note.text }}</p>
        <p v-else class="text-sm text-gray-500">{{ s.nothing }}</p>
        <button
          v-if="field.note.updatedByName && field.note.updatedAt" type="button"
          class="flex min-h-11 items-center gap-1 text-left text-sm text-gray-500 hover:text-gray-800 hover:underline"
          @click="history = { groupId: data.groupId, field }"
        >
          <UIcon name="i-lucide-history" class="size-4 shrink-0" />
          {{ s.lastChanged(field.note.updatedByName, formatDateTime(field.note.updatedAt)) }}
        </button>
      </section>

      <ChildrenGroupBookHistoryDialog
        v-if="history" v-model:open="historyOpen" :group-id="history.groupId" :field="history.field.field" :date="history.field.date"
        :title="history.field.title"
      />
    </template>
  </div>
</template>
