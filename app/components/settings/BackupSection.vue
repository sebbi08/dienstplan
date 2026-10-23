<script setup lang="ts">
import { de } from '~/locales/de'

/** Träger only (the page shows it to the Träger alone): the download of the whole database. */
</script>

<template>
  <section class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ de.settings.backup }}</h2>
    <p class="text-sm text-gray-600">{{ de.settings.backupHint }}</p>
    <a href="/api/backup" download class="inline-flex items-center gap-1 rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700">
      <UIcon name="i-lucide-download" /> {{ de.settings.backupDownload }}
    </a>
  </section>
</template>
