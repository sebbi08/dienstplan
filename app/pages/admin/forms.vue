<script setup lang="ts">
import { documentsLocation } from '~/utils/documents'

/** The old address of „Bögen“: now „Dokumente“ → „Vorlagen“ (bookmarks and old links keep working). */
definePageMeta({ redirect: to => documentsLocation('templates', to) })
</script>

<template>
  <div />
</template>
