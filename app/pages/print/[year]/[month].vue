<script setup lang="ts">
import { INTERNAL_QUERY, PRINT_QUERY, seesAllEvents } from '#shared/domain/calendarEvents'
import { formatTime } from '#shared/domain/time'
import type { MonthPlanDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { chipClasses } from '~/utils/colors'
import { errorCode, errorMessage } from '~/utils/errors'
import { formatDateTime, monthTitle } from '~/utils/format'
import { planBlocks, shownGroup } from '~/utils/groups'
import { planWithoutHidden } from '~/utils/longAbsence'
import { planColumnKinds, printLayout } from '~/utils/planPrint'
import { printFileName } from '~/utils/printFileName'

definePageMeta({ layout: false })

const route = useRoute()
const router = useRouter()
const year = Number(route.params.year)
const month = Number(route.params.month)
/**
 * Printouts get hung up: only appointments for „Alle“ (the server answers `?print=1` so). Leitung, Träger and whoever
 * manages the calendar may tick „Interne Termine mitdrucken“ (`&internal=1`, not remembered; also for the PDF).
 */
const { user } = useUserSession()
const { can } = useCan()
const mayPrintInternal = computed(() => !!user.value && seesAllEvents(user.value.role, can('calendar.edit')))
const internal = computed({
  get: () => mayPrintInternal.value && route.query[INTERNAL_QUERY] === '1',
  set: value => router.replace({ query: { ...route.query, [INTERNAL_QUERY]: value ? '1' : undefined } }),
})
const { data: plan, error } = await useFetch<MonthPlanDto>(`/api/plan/${year}/${month}`, {
  query: computed(() => ({ [PRINT_QUERY]: '1', ...(internal.value ? { [INTERNAL_QUERY]: '1' } : {}) })),
})

// "?group=3": only that group's block, plus the Springer and helpers (as chosen above the plan; the PDF passes it on).
const errorText = computed(() => (errorCode(error.value) === 'month_not_released' ? de.plan.notReleasedMonth(monthTitle(year, month)) : errorMessage(error.value)))
const group = computed(() => (plan.value ? shownGroup(plan.value, Number(route.query.group) || null) : null))
const groupName = computed(() => plan.value?.groups.find(candidate => candidate.id === group.value)?.name ?? null)
// „-intern“ at the end with „Interne Termine mitdrucken“ (printFileName).
const fileName = computed(() => printFileName(['Dienstplan', year, String(month).padStart(2, '0'), groupName.value], internal.value))
/** What the PDF page needs too: the group and „Interne Termine mitdrucken“. */
const search = computed(() => {
  const query = new URLSearchParams({ ...(group.value ? { group: String(group.value) } : {}), ...(internal.value ? { [INTERNAL_QUERY]: '1' } : {}) })
  return query.size ? `?${query}` : ''
})

/**
 * A4 landscape: the plan in its fixed print widths, scaled down to the page width; a plan too wide for that (many people)
 * is printed in parts, each from a new page with the dates again, the Info columns in the last (planPrint.ts).
 */
const printed = computed(() => (plan.value ? planWithoutHidden(plan.value) : null))
const layout = computed(() => (printed.value ? printLayout(planColumnKinds(planBlocks(printed.value, group.value))) : null))
</script>

<template>
  <div class="bg-white p-4 text-gray-900 print:p-0">
    <div class="mb-3 flex flex-wrap items-baseline gap-3 print:mb-1">
      <h1 class="text-2xl font-semibold print:text-lg">
        {{ monthTitle(year, month) }}<template v-if="plan?.facilityName"> – {{ plan.facilityName }}</template><template v-if="groupName"> – {{ groupName }}</template>
      </h1>
      <span v-if="plan?.release.releasedAt" class="text-sm text-gray-600">
        {{ de.plan.releasedAt(formatDateTime(plan.release.releasedAt), plan.release.releasedBy ?? '') }}
      </span>
      <span v-if="plan?.admin && (!plan.release.releasedAt || plan.release.pendingCount > 0)" class="text-sm font-semibold text-orange-700">
        {{ plan.release.releasedAt ? de.plan.printDraftNote(plan.release.pendingCount) : de.plan.draft }}
      </span>
      <span v-if="internal" class="text-sm font-semibold text-orange-700">{{ de.calendar.printInternalNote }}</span>
      <UCheckbox
        v-if="mayPrintInternal" v-model="internal" :label="de.calendar.printInternal" :description="de.calendar.printInternalHint"
        class="print:hidden"
      />
      <PrintActions :file-name="fileName" :search="search" />
    </div>
    <p v-if="error" class="text-red-700">{{ errorText }}</p>
    <template v-if="plan">
      <template v-for="(part, index) in layout?.parts ?? []" :key="index">
        <p v-if="index > 0" class="mt-4 mb-1 break-before-page text-sm font-semibold print:mt-0">
          {{ monthTitle(year, month) }}<template v-if="plan.facilityName"> – {{ plan.facilityName }}</template><template v-if="groupName"> – {{ groupName }}</template>
          · {{ de.plan.printPart(index + 1, layout!.parts.length) }}
        </p>
        <PlanGrid :plan="printed ?? plan" :group-filter="group" :print-part="part" :print-zoom="layout!.zoom" print />
      </template>
      <PlanLongAbsences :plan="plan" :group-filter="group" print class="mt-2 print:mt-1" />
      <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs print:mt-1 print:break-inside-avoid">
        <span class="font-semibold">{{ de.plan.legend }}:</span>
        <span v-for="template in plan.templates" :key="template.id">
          {{ template.shortLabel }} = {{ template.label }} {{ formatTime(template.start) }}–{{ formatTime(template.end) }}
        </span>
        <span v-for="code in plan.codes" :key="code.id" class="inline-flex items-center gap-1">
          <span class="inline-block h-3 w-3 rounded-sm" :class="chipClasses[code.color]" /> {{ code.label }}
        </span>
      </div>
    </template>
  </div>
</template>
