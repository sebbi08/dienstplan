<script setup lang="ts">
import { de } from '~/locales/de'

/** The small grey mark „gilt für alle Einrichtungen“ above a setting that is the same for every facility. */
</script>

<template>
  <p>
    <span class="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600" :title="de.settingsAreas.globalHint">
      <UIcon name="i-lucide-globe" class="size-3" aria-hidden="true" />{{ de.settingsAreas.global }}
    </span>
  </p>
</template>
