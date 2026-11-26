<script setup lang="ts">
import { RATING_LEGEND, type AnswerableItem, type FormAnswer, type MilestoneAnswer, type RatingAnswer } from '#shared/domain/forms'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'
import { isBlank } from '~/utils/forms'

/**
 * One stored answer shown compactly to read (the comparison of two forms, the history): formatted text through
 * FormsRichText (sanitized again there), the ticked options, the rating's symbol, the milestone and the date, each with
 * its remark, a table as a table, a Kästchen as angekreuzt / nicht angekreuzt. `value` undefined: the item is not in
 * that form („nicht im Bogen“).
 */
const props = defineProps<{ item: AnswerableItem | undefined; value: FormAnswer | undefined }>()
const h = de.formHistory

const ratingSymbol = (value: RatingAnswer['value']) => RATING_LEGEND.entries.find(entry => entry.value === value)
const choiceLabels = computed(() => {
  const item = props.item
  if (item?.kind !== 'choices' || !Array.isArray(props.value)) return []
  const picked = new Set(props.value as string[])
  return item.options.filter(option => picked.has(option.id)).map(option => option.label)
})
const rating = computed(() => props.value as RatingAnswer)
const milestone = computed(() => props.value as MilestoneAnswer)
</script>

<template>
  <p v-if="!props.item || props.value === undefined" class="text-sm text-gray-500 italic">{{ h.notInForm }}</p>
  <template v-else-if="props.item.kind === 'text'">
    <FormsRichText v-if="!isBlank(props.value)" :value="String(props.value)" class="text-sm text-gray-800" />
    <p v-else class="text-sm text-gray-500">{{ de.forms.noAnswer }}</p>
  </template>
  <template v-else-if="props.item.kind === 'choices'">
    <ul v-if="choiceLabels.length" class="flex flex-wrap gap-1">
      <li v-for="label in choiceLabels" :key="label" class="rounded-full bg-sky-50 px-2 py-0.5 text-sm break-words text-sky-900 ring-1 ring-sky-300">
        {{ label }}
      </li>
    </ul>
    <p v-else class="text-sm text-gray-500">{{ de.forms.noAnswer }}</p>
  </template>
  <div v-else-if="props.item.kind === 'rating'" class="text-sm">
    <span v-if="ratingSymbol(rating.value)" class="font-bold" :title="ratingSymbol(rating.value)!.label">{{ ratingSymbol(rating.value)!.symbol }}</span>
    <span v-else class="text-gray-500">{{ h.noRating }}</span>
    <span v-if="rating.remark" class="ml-2 break-words text-gray-700">{{ rating.remark }}</span>
  </div>
  <div v-else-if="props.item.kind === 'milestone'" class="text-sm">
    <span :class="milestone.reached ? 'font-medium text-green-800' : 'text-gray-600'">
      {{ milestone.reached ? `✓ ${h.reached}` : h.notReached }}
    </span>
    <span v-if="milestone.remark" class="ml-2 break-words text-gray-700">{{ milestone.remark }}</span>
  </div>
  <p v-else-if="props.item.kind === 'date'" class="text-sm">{{ typeof props.value === 'string' && props.value ? formatDate(props.value) : h.noDate }}</p>
  <FormsTableAnswer v-else-if="props.item.kind === 'table'" :item="props.item" :value="props.value" class="text-sm" />
  <p v-else-if="props.item.kind === 'checkbox'" class="text-sm" :class="props.value === true ? 'font-medium text-green-800' : 'text-gray-600'">
    {{ props.value === true ? `☒ ${h.checked}` : `☐ ${h.notChecked}` }}
  </p>
</template>
