<script setup lang="ts">
import type { StaffingEstimatesDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatNumber } from '~/utils/format'
import { formatFte } from '~/utils/staffing'
import { estimateLines } from '~/utils/staffingEstimate'

/**
 * Above the group list: the Personalschlüssel of the facility at full occupancy of every group with an estimate (with
 * the facility surcharges), this month's Soll, and the Leitungszeit shown only. Planning help; the server counts.
 */
const props = defineProps<{ data: Pick<StaffingEstimatesDto, 'facility' | 'land' | 'fteHoursPerWeek'> }>()

const t = de.staffing.estimate
const facility = computed(() => props.data.facility)
const hours = (fte: number) => formatNumber(fte * props.data.fteHoursPerWeek)
const lines = computed(() => estimateLines(facility.value.lines))
const current = computed(() => (facility.value.current && facility.value.current.children > 0 ? facility.value.current : null))
</script>

<template>
  <div class="space-y-1 rounded-md bg-sky-50 p-3 text-sm text-sky-950 ring-1 ring-sky-200">
    <p class="font-medium">{{ t.facilityTitle }} <span class="font-normal text-sky-800">({{ de.states[data.land] }})</span></p>
    <template v-if="facility.periodCheck">
      <template v-if="facility.fte !== null">
        <p>
          {{ t.facilityFull(facility.groupCount) }}
          <strong>{{ t.fte(formatFte(facility.fte)) }}</strong> = <strong>{{ t.hoursPerWeek(hours(facility.fte)) }}</strong>
        </p>
        <p v-for="line in lines.shown" :key="line.key">{{ t.leitung(line.label, hours(line.fte)) }}</p>
        <p v-if="facility.groupsWithout > 0" class="text-xs text-sky-800">{{ t.facilityWithout(facility.groupsWithout) }}</p>
      </template>
      <p v-else class="text-sky-800">{{ t.facilityNone }}</p>
      <p v-if="current">{{ t.current(current.children, formatFte(current.fte)) }}</p>
    </template>
    <p v-else class="text-sky-800">{{ t.presenceOnly }}</p>
    <p class="text-xs text-sky-800">{{ de.staffing.disclaimer }}</p>
  </div>
</template>
