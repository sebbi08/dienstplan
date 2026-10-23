<script setup lang="ts">
import { presetFor } from '#shared/domain/staffing/presets'
import type { QuotaLine } from '#shared/domain/staffing/types'
import type { StaffingFiguresDto, StaffingMonthDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate, formatNumber } from '~/utils/format'
import { formatFte, formatSignedFte, quotaLabel } from '~/utils/staffing'
import { inState } from '~/utils/states'

/**
 * The Personalschlüssel of a month as a table (the tab and its printout): one row per group with Soll, Ist and
 * Differenz in full-time positions, below it the surcharges and quotas, last the facility total; then the hints. Red
 * rows also carry a text and an icon, not just the colour. The server counts; this view only shows.
 */
const props = defineProps<{ data: StaffingMonthDto; print?: boolean }>()

const t = de.staffing
const meta = computed(() => props.data.meta)
const periodCheck = computed(() => meta.value.periodCheck)
// The group types of the state (for their names); the column is only shown where the state calculates with them.
const groupTypes = computed(() => presetFor(meta.value.land, meta.value.validFrom).groupTypes ?? [])
const showGroupType = computed(() => groupTypes.value.length > 0 || props.data.groups.some(row => row.groupType !== null))
const groupTypeLabel = (key: string | null) => (key === null ? de.children.noValue : groupTypes.value.find(type => type.key === key)?.label ?? key)

interface Row { key: string; name: string; groupType: string | null; figures: StaffingFiguresDto; total: boolean }
const rows = computed<Row[]>(() => [
  ...props.data.groups.map(row => ({
    key: String(row.groupId ?? 'none'), name: row.groupId === null ? t.noGroup : row.name, groupType: row.groupType, figures: row, total: false,
  })),
  { key: 'total', name: t.total, groupType: null, figures: props.data.total, total: true },
])
const columns = computed(() => 3 + (showGroupType.value ? 1 : 0) + (periodCheck.value ? 2 : 0))

/** The lines below a row: the surcharges, with the base demand when there is anything to add it to. */
const linesOf = (figures: StaffingFiguresDto) => (figures.required.lines.length > 1 ? figures.required.lines : [])
const lineHours = (fte: number) => t.lineHours(formatNumber(fte * meta.value.fteHoursPerWeek))
const quotaText = (quota: QuotaLine) => (quota.kind === 'max_share'
  ? t.quotaMax(formatFte(quota.limit), formatFte(quota.have))
  : t.quotaMin(formatFte(quota.limit), formatFte(quota.have)))
const stateText = (ok: boolean | null) => (ok === null ? t.noCheck : ok ? t.ok : t.short)
const rowClass = (ok: boolean | null) => (ok === false ? 'bg-red-50 text-red-900' : ok === true ? 'bg-green-50 text-green-900' : '')

const unmatchedGroups = computed(() => props.data.groups
  .filter(row => row.unmatchedChildren > 0)
  .map(row => `${row.groupId === null ? t.noGroup : row.name} (${row.unmatchedChildren})`)
  .join(', '))
const uncertain = computed(() => meta.value.confidence !== 'high')
const noCareDays = computed(() => periodCheck.value && meta.value.careDays === 0)

const th = props.print ? 'px-1.5 py-1' : 'px-3 py-2'
const td = props.print ? 'px-1.5 py-1' : 'px-3 py-2'
const sub = props.print ? 'px-1.5 py-0.5' : 'px-3 py-1'
</script>

<template>
  <div class="space-y-3">
    <p v-if="uncertain" class="flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm font-medium text-amber-900 ring-1 ring-amber-200">
      <UIcon name="i-lucide-triangle-alert" class="size-5 shrink-0" aria-hidden="true" /> {{ t.pleaseCheck }} – {{ t.pleaseCheckHint }}
    </p>
    <p v-if="meta.qualificationsMissing" class="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">{{ t.qualificationsMissing }}</p>
    <p v-if="!periodCheck" class="rounded-lg bg-sky-50 p-3 text-sm text-sky-900 ring-1 ring-sky-200">{{ t.presenceOnly(inState(meta.land)) }}</p>
    <p v-if="noCareDays" class="text-sm text-gray-600">{{ t.noCareDays }}</p>

    <p v-if="!data.groups.length" class="text-sm text-gray-600">{{ t.empty }}</p>
    <!-- relative: the screen-reader texts in the cells stay inside the scrolling box (no sideways page scroll on a phone). -->
    <div v-else class="relative overflow-x-auto" :class="print ? '' : 'rounded-lg ring-1 ring-gray-200'">
      <table class="w-full bg-white" :class="print ? 'text-xs' : 'text-sm'">
        <thead class="text-left text-xs text-gray-600" :class="print ? 'border-b border-gray-400' : 'bg-gray-100'">
          <tr>
            <th :class="th">{{ t.group }}</th>
            <th v-if="showGroupType" :class="th">{{ t.groupType }}</th>
            <th :class="[th, 'text-right']">{{ t.children }}</th>
            <template v-if="periodCheck">
              <th :class="[th, 'text-right']">{{ t.required }}</th>
              <th :class="[th, 'text-right']">{{ t.planned }}</th>
              <th :class="[th, 'text-right']">{{ t.diff }}</th>
            </template>
          </tr>
        </thead>
        <tbody v-for="row in rows" :key="row.key" :class="row.total ? 'border-t-2 border-gray-400' : 'border-t border-gray-200'">
          <tr :class="[rowClass(row.figures.ok), row.total ? 'font-semibold' : '']">
            <th scope="row" :class="[td, 'text-left font-medium']">{{ row.name }}</th>
            <td v-if="showGroupType" :class="td">{{ row.total ? '' : groupTypeLabel(row.groupType) }}</td>
            <td :class="[td, 'text-right tabular-nums']">{{ t.childrenCount(row.figures.children.total, row.figures.children.u3) }}</td>
            <template v-if="periodCheck">
              <td :class="[td, 'text-right tabular-nums']">{{ formatFte(row.figures.required.fte) }}</td>
              <td :class="[td, 'text-right tabular-nums']">{{ row.figures.planned.fte === null ? de.children.noValue : formatFte(row.figures.planned.fte) }}</td>
              <td :class="[td, 'text-right tabular-nums whitespace-nowrap']">
                <span class="inline-flex items-center gap-1" :class="row.figures.ok === false ? 'font-semibold text-red-700' : row.figures.ok ? 'text-green-700' : ''">
                  <UIcon v-if="row.figures.ok === false" name="i-lucide-triangle-alert" class="size-4" aria-hidden="true" />
                  <UIcon v-else-if="row.figures.ok" name="i-lucide-check" class="size-4" aria-hidden="true" />
                  {{ row.figures.diff === null ? de.children.noValue : formatSignedFte(row.figures.diff) }}
                  <span class="sr-only">{{ stateText(row.figures.ok) }}</span>
                </span>
              </td>
            </template>
          </tr>
          <template v-if="periodCheck">
            <tr v-for="line in linesOf(row.figures)" :key="line.key" class="text-xs text-gray-600">
              <td :class="[sub, 'pl-6']" :colspan="columns - 3">
                {{ line.label }}<span v-if="!line.counts" class="text-gray-500"> ({{ t.shownOnly }})</span>
              </td>
              <td :class="[sub, 'text-right tabular-nums whitespace-nowrap']">{{ formatFte(line.fte) }}</td>
              <td :class="[sub, 'text-gray-500 whitespace-nowrap']" colspan="2">{{ lineHours(line.fte) }}</td>
            </tr>
            <tr v-for="quota in row.figures.quotas" :key="quota.key" class="text-xs" :class="quota.ok ? 'text-gray-600' : 'font-semibold text-red-700'">
              <td :class="[sub, 'pl-6']" :colspan="columns - 3">{{ quotaLabel(quota) }} ({{ t.quotaFte }})</td>
              <td :class="[sub, 'text-right whitespace-nowrap']" colspan="3">
                <span class="inline-flex items-center gap-1">
                  <UIcon :name="quota.ok ? 'i-lucide-check' : 'i-lucide-triangle-alert'" class="size-4" aria-hidden="true" />
                  {{ quotaText(quota) }}<span class="sr-only">, {{ stateText(quota.ok) }}</span>
                </span>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
    <p v-if="periodCheck && data.groups.length" class="text-xs text-gray-500">{{ t.fteHint }} {{ t.basis(meta.careDays, formatNumber(meta.fteHoursPerWeek)) }}</p>

    <ul class="list-disc space-y-1 pl-5 text-sm text-gray-700">
      <li v-if="data.total.staffWithoutQualification.length">{{ t.staffWithoutQualification(data.total.staffWithoutQualification.join(', ')) }}</li>
      <li v-if="data.total.childrenWithoutCareType">{{ t.childrenWithoutCareType(data.total.childrenWithoutCareType) }}</li>
      <li v-if="data.total.unmatchedChildren">{{ t.unmatched(data.total.unmatchedChildren, unmatchedGroups) }}</li>
      <li>{{ t.noPedagogic }}</li>
    </ul>

    <div class="space-y-1 text-xs text-gray-600">
      <p>{{ t.source(meta.source, formatDate(meta.validFrom)) }}</p>
      <p v-if="meta.note">{{ meta.note }}</p>
      <p class="font-medium text-gray-800">{{ t.disclaimer }}</p>
    </div>
  </div>
</template>
