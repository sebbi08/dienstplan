<script setup lang="ts">
import { formatTime } from '#shared/domain/time'
import type { MonthPlanDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { chipClasses } from '~/utils/colors'
import { errorMessage } from '~/utils/errors'
import { formatDateTime, monthTitle } from '~/utils/format'

definePageMeta({ layout: false })

const route = useRoute()
const year = Number(route.params.year)
const month = Number(route.params.month)
const { data: plan, error } = await useFetch<MonthPlanDto>(`/api/plan/${year}/${month}`)

function print() {
  window.print()
}
</script>

<template>
  <div class="bg-white p-4 text-gray-900">
    <div class="mb-3 flex flex-wrap items-baseline gap-3">
      <h1 class="text-2xl font-semibold">{{ monthTitle(year, month) }}</h1>
      <span v-if="plan?.release.releasedAt" class="text-sm text-gray-600">
        {{ de.plan.releasedAt(formatDateTime(plan.release.releasedAt), plan.release.releasedBy ?? '') }}
      </span>
      <span v-if="plan?.admin && (!plan.release.releasedAt || plan.release.pendingCount > 0)" class="text-sm font-semibold text-orange-700">
        {{ plan.release.releasedAt ? de.plan.printDraftNote(plan.release.pendingCount) : de.plan.draft }}
      </span>
      <UButton class="ml-auto print:hidden" icon="i-lucide-printer" :label="de.plan.printNow" @click="print" />
    </div>
    <p v-if="error" class="text-red-700">{{ errorMessage(error) }}</p>
    <template v-if="plan">
      <PlanGrid :plan="plan" />
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
