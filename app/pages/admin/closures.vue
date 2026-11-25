<script setup lang="ts">
import { MOVED_PAGES, movedLocation } from '~/utils/areaTabs'

/** The old address of the closures: now the tab „Schließzeiten“ of „Kalender“ (bookmarks and old links keep working). */
definePageMeta({ redirect: to => movedLocation(MOVED_PAGES['/admin/closures'], to) })
</script>

<template>
  <div />
</template>
