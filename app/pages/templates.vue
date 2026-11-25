<script setup lang="ts">
import { documentsLocation } from '~/utils/documents'

/** The old address of the print templates: now „Dokumente“ → „Zum Ausdrucken“ (bookmarks and old links keep working). */
definePageMeta({ redirect: to => documentsLocation('templates', to) })
</script>

<template>
  <div />
</template>
