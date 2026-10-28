<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'

const { user } = useUserSession()
const { can } = useCan()
const { year, month } = parseIsoDate(todayIso())
// The tablet starts at stamping; whoever edits the plan at the plan, everyone else at the own plan.
const target = user.value?.role === 'terminal'
  ? '/terminal'
  : can('plan.edit') ? `/plan/${year}/${month}` : `/my/plan/${year}/${month}`
await navigateTo(target, { replace: true })
</script>

<template>
  <div />
</template>
