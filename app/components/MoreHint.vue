<script setup lang="ts">
import { de } from '~/locales/de'

/**
 * A hint with one short part that is always visible and the rest (details, legal background) behind „Mehr erfahren“.
 * The text size and colour come from the caller's class, e.g. `class="text-xs text-gray-500"`. Without `more` it is a
 * plain paragraph. Long texts belong here rather than in the ⓘ popover (InfoHint), which suits a sentence or two. The
 * default slot (e.g. a link) follows the short part.
 */
defineProps<{ text: string, more?: string }>()
const open = ref(false)
const id = useId()
</script>

<template>
  <div>
    <p>
      {{ text }}
      <slot />
      <button
        v-if="more" type="button" class="whitespace-nowrap font-medium text-sky-700 hover:underline print:hidden"
        :aria-expanded="open" :aria-controls="id" @click="open = !open"
      >
        {{ open ? de.common.lessInfo : de.common.moreInfo }}
      </button>
    </p>
    <p v-if="more" v-show="open" :id="id" class="mt-1 whitespace-pre-line">{{ more }}</p>
  </div>
</template>
