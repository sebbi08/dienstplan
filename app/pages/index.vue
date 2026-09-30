<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'

const { year, month } = parseIsoDate(todayIso())
await navigateTo(`/plan/${year}/${month}`, { replace: true })
</script>

<template>
  <div />
</template>
