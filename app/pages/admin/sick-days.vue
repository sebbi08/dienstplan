<script setup lang="ts">
import { MOVED_PAGES, movedLocation } from '~/utils/areaTabs'

/** The old address of the sick days: now the tab „Krankheitstage“ of „Mitarbeiter“ (bookmarks and old links keep working). */
definePageMeta({ redirect: to => movedLocation(MOVED_PAGES['/admin/sick-days'], to) })
</script>

<template>
  <div />
</template>
