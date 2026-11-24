<script setup lang="ts">
import type { AnswerDiff, ItemChange } from '#shared/domain/formHistory'
import { RATING_LEGEND, type AnswerableItem, type RatingValue } from '#shared/domain/forms'
import { nowInBerlin } from '#shared/domain/timeRecords'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'

/**
 * Under an item of a form: „geändert am … von …“ (only when it was ever changed), else `origin` (a copied staff talk
 * form: „übernommen aus dem Gespräch vom …“), the marker „neu seit deinem letzten Öffnen“, and in a stored state with „Änderungen zeigen“ how the item differs from today (texts word by word as
 * plain text — never as HTML —, options added and dropped, rating, milestone and date as „damals → heute“).
 */
const props = defineProps<{ item: AnswerableItem; change?: ItemChange; origin?: string; marked?: boolean; diff?: AnswerDiff }>()
const h = de.formHistory

const rating = (value: RatingValue | null) => (value === null ? h.noRating : RATING_LEGEND.entries.find(entry => entry.value === value)?.symbol ?? value)
const reached = (value: boolean) => (value ? h.reached : h.notReached)
const day = (value: string | null) => (value ? formatDate(value) : h.noDate)
const statusClass = { new: 'bg-green-100 text-green-800', changed: 'bg-amber-100 text-amber-900', removed: 'bg-red-100 text-red-800' } as const
</script>

<template>
  <div v-if="props.change || props.origin || props.marked || (props.diff && props.diff.status !== 'same')" class="space-y-1">
    <p v-if="props.change || props.origin || props.marked" class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500">
      <span v-if="props.change">{{ h.changedAt(formatDate(nowInBerlin(new Date(props.change.changedAt)).date), props.change.changedBy) }}</span>
      <span v-else-if="props.origin">{{ props.origin }}</span>
      <span v-if="props.marked" class="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-900">{{ h.changedSinceSeen }}</span>
    </p>
    <div v-if="props.diff && props.diff.status !== 'same'" class="space-y-1 rounded-md bg-amber-50/60 p-2 text-sm ring-1 ring-amber-200">
      <span class="inline-block rounded px-1.5 py-0.5 text-xs font-semibold" :class="statusClass[props.diff.status]">{{ h.status[props.diff.status] }}</span>
      <p v-if="props.diff.detail.kind === 'text'" class="break-words whitespace-pre-wrap">
        <template v-for="(segment, index) in props.diff.detail.segments" :key="index">
          <ins v-if="segment.op === 'add'" class="bg-green-100 text-green-900 no-underline">{{ segment.text }}</ins>
          <del v-else-if="segment.op === 'del'" class="bg-red-100 text-red-800">{{ segment.text }}</del>
          <span v-else>{{ segment.text }}</span>
        </template>
      </p>
      <div v-else-if="props.diff.detail.kind === 'choices'" class="space-y-0.5">
        <p v-if="props.diff.detail.added.length"><span class="font-medium text-green-800">{{ h.added }}:</span> {{ props.diff.detail.added.join(', ') }}</p>
        <p v-if="props.diff.detail.removed.length"><span class="font-medium text-red-800">{{ h.dropped }}:</span> {{ props.diff.detail.removed.join(', ') }}</p>
        <p v-if="props.diff.detail.kept.length" class="text-gray-600">{{ h.kept }}: {{ props.diff.detail.kept.join(', ') }}</p>
      </div>
      <div v-else-if="props.diff.detail.kind === 'rating' || props.diff.detail.kind === 'milestone'" class="space-y-0.5">
        <p>
          <span class="text-gray-600">{{ h.then }}</span>
          <strong class="mx-1">{{ props.diff.detail.kind === 'rating' ? rating(props.diff.detail.from) : reached(props.diff.detail.from) }}</strong>
          → <span class="text-gray-600">{{ h.now }}</span>
          <strong class="ml-1">{{ props.diff.detail.kind === 'rating' ? rating(props.diff.detail.to) : reached(props.diff.detail.to) }}</strong>
        </p>
        <p v-if="props.diff.detail.remarkFrom !== props.diff.detail.remarkTo" class="break-words">
          {{ h.remark }}: <del class="bg-red-100 text-red-800">{{ props.diff.detail.remarkFrom || h.empty }}</del>
          → <ins class="bg-green-100 text-green-900 no-underline">{{ props.diff.detail.remarkTo || h.empty }}</ins>
        </p>
      </div>
      <p v-else-if="props.diff.detail.kind === 'date'">
        <span class="text-gray-600">{{ h.then }}</span> <strong>{{ day(props.diff.detail.from) }}</strong>
        → <span class="text-gray-600">{{ h.now }}</span> <strong>{{ day(props.diff.detail.to) }}</strong>
      </p>
    </div>
  </div>
</template>
