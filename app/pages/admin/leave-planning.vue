<script setup lang="ts">
import { parseIsoDate, todayIso, weekday } from '#shared/domain/dates'
import type { LeavePlanningDto, LeaveSettingsDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate, formatDayShort } from '~/utils/format'
import type { LeaveFilter } from '~/utils/leaveYearList'

/**
 * For the people responsible for leave planning: open requests, the limit and a year calendar of leave and wishes
 * („Planung“), and every request and leave period of the year („Alle Anträge und Urlaube“).
 * Whoever sees the leave overview (Leitung, Träger) also without planning, or while leave requests are off: then only
 * the notice on remaining leave („Hinweis auf Resturlaub ‹Jahr›“), which every visitor sees at the end.
 */
const route = useRoute()
const year = ref(Number(route.query.year) || parseIsoDate(todayIso()).year)
const { data: leaveSettings } = await useFetch<LeaveSettingsDto>('/api/leave-settings')
const isPlanner = computed(() => !!leaveSettings.value?.isPlanner)
const { data: planning, error, refresh } = await useFetch<LeavePlanningDto>('/api/leave-planning', { query: { year }, enabled: isPlanner })
// Decisions also update the open-request count in the menu.
const decided = () => Promise.all([refresh(), refreshNuxtData('leave-settings')])
const run = useAction(decided)

/** „Planung“ or „Alle Anträge und Urlaube“ (planners only), kept in the address (?tab=all). */
type PlanningTab = 'planning' | 'all'
const TABS: PlanningTab[] = ['planning', 'all']
const router = useRouter()
const tab = computed<PlanningTab>(() => (route.query.tab === 'all' ? 'all' : 'planning'))
function selectTab(next: PlanningTab) {
  router.replace({ query: { ...route.query, tab: next === 'all' ? 'all' : undefined } })
}
/** Arrow keys, Home and End move between the tabs (and open the one reached), as in a tab list. */
function onTabKey(event: KeyboardEvent) {
  const next = { ArrowRight: 'all', ArrowLeft: 'planning', Home: 'planning', End: 'all' }[event.key] as PlanningTab | undefined
  if (!next) return
  event.preventDefault()
  selectTab(next)
  nextTick(() => document.getElementById(`leave-tab-${next}`)?.focus())
}
const tabLabels: Record<PlanningTab, string> = { planning: de.leaveYearList.tabPlanning, all: de.leaveYearList.tabAll }
const yearFilter = ref<LeaveFilter>({ employeeId: null, kind: null, status: null })

const limit = ref<number | null>(null)
watch(planning, value => (limit.value = value?.maxConcurrent ?? null), { immediate: true })
function saveLimit() {
  const value = limit.value === null || String(limit.value) === '' ? null : Number(limit.value)
  run(() => $fetch<unknown>('/api/leave-settings/max', { method: 'PUT', body: { value } }), de.common.saved)
}

const daysText = (dates: string[]) => dates.map(date => formatDayShort(date, weekday(date))).join(', ')

// „Urlaub eintragen“ per person, as editing the plan; the own leave only the Träger (others request it).
const { user } = useUserSession()
const { can } = useCan()
const entryEmployees = computed(() => (can('plan.edit') ? planning.value?.calendar.employees ?? [] : [])
  .filter(employee => employee.id !== user.value?.employeeId || user.value?.role === 'provider'))
const entryItems = computed(() => entryEmployees.value.map(employee => ({ label: employee.name, value: employee.id })))
/** The chosen person (undefined: none yet) and the dialog. */
const entryEmployeeId = ref<number | undefined>(undefined)
const entryOpen = ref(false)
const entryName = computed(() => entryEmployees.value.find(employee => employee.id === entryEmployeeId.value)?.name ?? '')
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-2xl font-semibold">{{ de.leavePlanning.title }}</h1>
      <YearNav v-model="year" />
    </div>
    <UAlert v-if="isPlanner && error" color="warning" variant="soft" :title="errorMessage(error)" />

    <div v-if="isPlanner" role="tablist" :aria-label="de.leaveYearList.tabsLabel" class="flex flex-wrap gap-1.5">
      <button
        v-for="key in TABS" :id="`leave-tab-${key}`" :key="key" type="button" role="tab"
        :aria-selected="tab === key" :tabindex="tab === key ? 0 : -1" :aria-controls="`leave-panel-${key}`"
        class="min-h-10 rounded-full px-3.5 text-sm ring-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        :class="tab === key ? 'bg-sky-50 font-semibold text-sky-800 ring-sky-400' : 'bg-white text-gray-700 ring-gray-200 hover:bg-gray-50'"
        @click="selectTab(key)" @keydown="onTabKey"
      >
        {{ tabLabels[key] }}
      </button>
    </div>

    <div v-if="isPlanner && tab === 'all'" id="leave-panel-all" role="tabpanel" aria-labelledby="leave-tab-all">
      <LeaveYearList v-model:filter="yearFilter" :year="year" @decided="decided" />
    </div>
    <div v-else-if="isPlanner && planning" id="leave-panel-planning" role="tabpanel" aria-labelledby="leave-tab-planning" class="space-y-4">
      <section class="max-w-4xl space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
        <h2 class="font-semibold">{{ de.leavePlanning.openRequests }}</h2>
        <p v-if="!planning.openRequests.length" class="text-sm text-gray-500">{{ de.leavePlanning.noOpenRequests }}</p>
        <div v-for="request in planning.openRequests" :key="request.id" class="space-y-1 border-t border-gray-100 pt-2 text-sm first:border-0 first:pt-0">
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span class="font-semibold">{{ request.name }}</span>
            <UBadge v-if="request.kind === 'overtime_off'" color="secondary" variant="soft" :label="de.leaveRequests.kinds.overtime_off" />
            <span>{{ de.leavePlanning.range(formatDate(request.startDate), formatDate(request.endDate), request.workdays) }}</span>
            <LeaveDecisionButtons class="ml-auto" :request="request" @decided="decided" />
          </div>
          <p v-if="request.note" class="text-gray-600">„{{ request.note }}“</p>
          <p v-if="request.overLimitDates.length" class="font-medium text-purple-700">
            {{ de.leavePlanning.overLimitDays(daysText(request.overLimitDates)) }}
          </p>
        </div>
      </section>

      <form
        v-if="entryEmployees.length" class="flex max-w-4xl flex-wrap items-end gap-3 rounded-lg bg-white p-4 ring-1 ring-gray-200"
        @submit.prevent="entryOpen = entryEmployeeId !== undefined"
      >
        <UFormField :label="de.leaveEntry.person">
          <USelect v-model="entryEmployeeId" :items="entryItems" :placeholder="de.leaveEntry.personPlaceholder" class="w-56" />
        </UFormField>
        <UButton type="submit" icon="i-lucide-calendar-plus" :label="de.leaveEntry.add" :disabled="entryEmployeeId === undefined" />
        <LeaveEntryDialog
          v-if="entryEmployeeId !== undefined" v-model:open="entryOpen" :employee-id="entryEmployeeId" :name="entryName"
          @saved="refresh"
        />
      </form>

      <form class="flex max-w-4xl flex-wrap items-end gap-3 rounded-lg bg-white p-4 ring-1 ring-gray-200" @submit.prevent="saveLimit">
        <UFormField :label="de.leavePlanning.limit" :hint="de.leavePlanning.limitHint">
          <UInput v-model.number="limit" type="number" min="1" max="100" class="w-32" />
        </UFormField>
        <UButton type="submit" :label="de.common.save" />
      </form>

      <LeaveForfeitList :year="year" />

      <CalendarLegend planning />
      <CalendarGroupLegend :groups="planning.calendar.groups" />
      <div class="space-y-3 overflow-x-auto">
        <div v-for="month in 12" :key="month" class="min-w-[900px] rounded-lg bg-white">
          <CalendarMonth :calendar="planning.calendar" :month="month" :counts="planning.counts" :limit="planning.maxConcurrent" />
        </div>
      </div>
    </div>
    <LeaveForfeitList v-else :year="year" />
  </div>
</template>
