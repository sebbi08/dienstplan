<script setup lang="ts">
import { de } from '~/locales/de'

/**
 * „Offen (n)“ in the plan's header row: the Leitung's own to-dos (with a linked employee), the same as the card
 * „Offen für dich“ on „Mein Dienstplan“ (useOpenItems), opened in a side panel so the plan keeps its room. Hidden while
 * nothing is open.
 */
const { links, count } = useOpenItems()
const open = ref(false)
</script>

<template>
  <template v-if="count > 0">
    <UButton
      size="sm" color="primary" variant="soft" icon="i-lucide-inbox" :label="de.openItems.button(count)"
      :aria-label="de.openItems.buttonLabel(count)" aria-haspopup="dialog" class="print:hidden" @click="open = true"
    />
    <USlideover v-model:open="open" :title="de.openItems.title" :description="de.openItems.panelHint" class="print:hidden">
      <template #body>
        <OpenItemsList :links="links" class="flex flex-col items-start gap-2" @navigate="open = false" />
      </template>
    </USlideover>
  </template>
</template>
