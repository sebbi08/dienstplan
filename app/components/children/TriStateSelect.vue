<script setup lang="ts">
import type { TriState } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * ja / nein / offen (not answered yet); "offen" is grey so missing answers stand out. Without `allowYes` "ja" is not
 * offered (an answer that may only be withdrawn or cleared, e.g. to a hidden consent question).
 */
const props = withDefaults(defineProps<{ readonly?: boolean; label?: string; allowYes?: boolean }>(), { allowYes: true })
const model = defineModel<TriState>({ required: true })

const options: { value: TriState; label: string }[] = [
  { value: true, label: de.children.triState.yes },
  { value: false, label: de.children.triState.no },
  { value: null, label: de.children.triState.open },
]
const current = computed(() => options.find(option => option.value === model.value)!)
const offered = computed(() => (props.allowYes ? options : options.filter(option => option.value !== true)))
</script>

<template>
  <span
    v-if="props.readonly"
    :class="model === null ? 'rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-600' : ''"
  >{{ current.label }}</span>
  <div v-else class="inline-flex gap-1" role="group" :aria-label="props.label">
    <UButton
      v-for="option in offered" :key="String(option.value)" type="button" size="xs"
      :color="option.value === null ? 'neutral' : 'primary'" :variant="model === option.value ? 'solid' : 'outline'"
      :aria-pressed="model === option.value" :label="option.label" @click="model = option.value"
    />
  </div>
</template>
