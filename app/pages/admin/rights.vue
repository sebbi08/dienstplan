<script setup lang="ts">
import { movedLocation } from '~/utils/areaTabs'

/** The old address of „Rechte und Rollen“: now the tab „Rechte und Rollen“ of „Benutzer & Rechte“ (old links keep working). */
definePageMeta({ redirect: to => movedLocation('/admin/users/rights', to) })
</script>

<template>
  <div />
</template>
