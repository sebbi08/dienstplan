<script setup lang="ts">
import { de } from '~/locales/de'

/**
 * „Offen für dich“: what waits for the signed-in person (their linked employee), one line per kind with its count and a
 * link to the page where it is done – „Gelesen und verstanden“, Zu unterschreiben, Selbstbeurteilung, Rückmeldungen zu
 * Urlaubsanträgen, Hinweis zum Resturlaub, fällige Pflichttermine; for Leitung and Träger the Pflichttermine whose
 * attendance is to be confirmed. Hidden while nothing is open, at the tablet and for accounts with neither a linked
 * employee nor that right (useOpenItems; the plan page shows the same as „Offen (n)“).
 */
const { links } = useOpenItems()
</script>

<template>
  <section
    v-if="links.length" class="rounded-lg bg-sky-50 px-4 py-3 ring-1 ring-sky-200 print:hidden" aria-labelledby="open-items-title"
  >
    <h2 id="open-items-title" class="mb-1.5 text-sm font-semibold text-sky-900">{{ de.openItems.title }}</h2>
    <OpenItemsList :links="links" class="flex flex-wrap gap-2" />
  </section>
</template>
