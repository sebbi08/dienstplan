<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'

const { user } = useUserSession()
const { year, month } = parseIsoDate(todayIso())
const target = user.value?.role === 'terminal'
  ? '/terminal'
  : user.value?.role === 'observer' ? `/my/plan/${year}/${month}` : `/plan/${year}/${month}`
await navigateTo(target, { replace: true })
</script>

<template>
  <div />
</template>
