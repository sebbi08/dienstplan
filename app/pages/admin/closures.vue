<script setup lang="ts">
import { movedLocation } from '~/utils/areaTabs'

/** The old address of the closures: now the tab „Schließzeiten“ of „Kalender“ (bookmarks and old links keep working). */
definePageMeta({ redirect: to => movedLocation('/admin/calendar/closures', to) })
</script>

<template>
  <div />
</template>
