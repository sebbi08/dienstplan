<script setup lang="ts">
import { documentsLocation } from '~/utils/documents'

/** The old address of „Bögen“: now „Dokumente“ → „Bögen“ (bookmarks and old links keep working). */
definePageMeta({ redirect: to => documentsLocation('forms', to) })
</script>

<template>
  <div />
</template>
