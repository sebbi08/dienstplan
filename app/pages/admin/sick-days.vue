<script setup lang="ts">
import { movedLocation } from '~/utils/areaTabs'

/** The old address of the sick days: now the tab „Krankheitstage“ of „Mitarbeiter“ (bookmarks and old links keep working). */
definePageMeta({ redirect: to => movedLocation('/admin/employees/sick-days', to) })
</script>

<template>
  <div />
</template>
