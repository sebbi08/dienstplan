<script setup lang="ts">
import { de } from '~/locales/de'

/**
 * „Reihenfolge ändern“ / „Fertig“ above a list (as in the list of Mitarbeiter): the ▲/▼ of its rows show only while it is
 * on, so the rows stay calm and nobody moves an entry by mistake.
 */
withDefaults(defineProps<{ size?: 'xs' | 'sm' | 'md' }>(), { size: 'sm' })
const on = defineModel<boolean>({ required: true })
</script>

<template>
  <UButton
    :size="size" color="neutral" :variant="on ? 'solid' : 'outline'" :icon="on ? 'i-lucide-check' : 'i-lucide-arrow-up-down'"
    :label="on ? de.common.reorderDone : de.common.reorder" :aria-pressed="on" @click="on = !on"
  />
</template>
