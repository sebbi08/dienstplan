<script setup lang="ts">
import type { GermanState } from '#shared/domain/states'
import type { StaffingEstimateCurrentDto, StaffingEstimateDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatNumber } from '~/utils/format'
import { formatFte } from '~/utils/staffing'
import { assumptionText, estimateLines, presenceSentence } from '~/utils/staffingEstimate'

/**
 * The Personalschlüssel of one group as the state's rules demand it if all places were taken, with the presence rules,
 * the Leitungszeit of the group (if the state gives it per group), this month's Soll and the assumptions — or a friendly
 * hint what is missing. Planning help: the server counts, this view only words it.
 */
const props = defineProps<{
  estimate: StaffingEstimateDto & { current?: StaffingEstimateCurrentDto | null }
  land: GermanState
  fteHoursPerWeek: number
}>()

const t = de.staffing.estimate
const hours = (fte: number) => formatNumber(fte * props.fteHoursPerWeek)
const lines = computed(() => estimateLines(props.estimate.lines))
const presence = computed(() => presenceSentence(props.estimate.presence))
const computedFte = computed(() => (props.estimate.reason === null && props.estimate.periodCheck ? props.estimate.fte : null))
const current = computed(() => {
  const value = props.estimate.current
  return value && value.children > 0 && props.estimate.periodCheck ? value : null
})
</script>

<template>
  <div class="space-y-1 text-sm">
    <p class="font-medium">{{ t.heading(de.states[land]) }}</p>
    <p v-if="estimate.reason" class="flex items-start gap-1.5 text-gray-600">
      <UIcon name="i-lucide-info" class="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {{ t.reasons[estimate.reason] }}
    </p>
    <template v-if="computedFte !== null && estimate.capacity !== null">
      <p>
        {{ t.full(estimate.capacity, estimate.groupTypeLabel) }}
        <strong>{{ t.fte(formatFte(computedFte)) }}</strong>
        {{ t.perFte(formatNumber(fteHoursPerWeek)) }} =
        <strong>{{ t.hoursPerWeek(hours(computedFte)) }}</strong>
      </p>
      <p v-for="line in lines.included" :key="line.key" class="text-gray-600">{{ t.included(line.label, hours(line.fte)) }}</p>
      <p v-if="estimate.fachkraftFte > 0" class="text-gray-600">{{ t.fachkraft(formatFte(estimate.fachkraftFte)) }}</p>
      <p v-if="estimate.withU3Fte !== null" class="text-gray-600">{{ t.withU3(formatFte(estimate.withU3Fte)) }}</p>
    </template>
    <p v-else-if="!estimate.periodCheck && !estimate.reason" class="text-gray-600">{{ t.presenceOnly }}</p>
    <p v-if="presence">{{ presence }}</p>
    <template v-if="computedFte !== null">
      <p v-for="line in lines.shown" :key="line.key">{{ t.leitung(line.label, hours(line.fte)) }}</p>
      <p v-if="estimate.unmatchedChildren > 0" class="text-amber-800">{{ t.unmatched(estimate.unmatchedChildren) }}</p>
    </template>
    <p v-if="current">{{ t.current(current.children, formatFte(current.fte)) }}</p>
    <p v-if="computedFte !== null && estimate.assumptions" class="text-xs text-gray-500">{{ assumptionText(estimate.assumptions) }}</p>
  </div>
</template>
