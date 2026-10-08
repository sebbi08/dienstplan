<script setup lang="ts">
import { formatTime } from '#shared/domain/time'
import type { MonthPlanDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { chipClasses } from '~/utils/colors'
import { errorMessage } from '~/utils/errors'
import { formatDateTime, monthTitle } from '~/utils/format'
import { shownGroup } from '~/utils/groups'

definePageMeta({ layout: false })

const route = useRoute()
const year = Number(route.params.year)
const month = Number(route.params.month)
const { data: plan, error } = await useFetch<MonthPlanDto>(`/api/plan/${year}/${month}`)

// "?group=3": only that group's block, plus the Springer and helpers (as chosen above the plan; the PDF passes it on).
const group = computed(() => (plan.value ? shownGroup(plan.value, Number(route.query.group) || null) : null))
const groupName = computed(() => plan.value?.groups.find(candidate => candidate.id === group.value)?.name ?? null)
const UMLAUTS: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss' }
const fileGroup = computed(() => groupName.value?.replace(/[äöüÄÖÜß]/g, letter => UMLAUTS[letter]!) ?? null)
const fileName = computed(() => `Dienstplan-${year}-${String(month).padStart(2, '0')}${fileGroup.value ? `-${fileGroup.value}` : ''}`)

</script>

<template>
  <div class="bg-white p-4 text-gray-900">
    <div class="mb-3 flex flex-wrap items-baseline gap-3">
      <h1 class="text-2xl font-semibold">
        {{ monthTitle(year, month) }}<template v-if="plan?.facilityName"> – {{ plan.facilityName }}</template><template v-if="groupName"> – {{ groupName }}</template>
      </h1>
      <span v-if="plan?.release.releasedAt" class="text-sm text-gray-600">
        {{ de.plan.releasedAt(formatDateTime(plan.release.releasedAt), plan.release.releasedBy ?? '') }}
      </span>
      <span v-if="plan?.admin && (!plan.release.releasedAt || plan.release.pendingCount > 0)" class="text-sm font-semibold text-orange-700">
        {{ plan.release.releasedAt ? de.plan.printDraftNote(plan.release.pendingCount) : de.plan.draft }}
      </span>
      <PrintActions :file-name="fileName" :search="group ? `?group=${group}` : ''" />
    </div>
    <p v-if="error" class="text-red-700">{{ errorMessage(error) }}</p>
    <template v-if="plan">
      <PlanGrid :plan="plan" :group-filter="group" print />
      <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
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
