<script setup lang="ts">
import { MOVED_PAGES, movedLocation } from '~/utils/areaTabs'

/** The old address of „Rechte und Rollen“: now the tab „Rechte und Rollen“ of „Benutzer & Rechte“ (old links keep working). */
definePageMeta({ redirect: to => movedLocation(MOVED_PAGES['/admin/rights'], to) })
</script>

<template>
  <div />
</template>
