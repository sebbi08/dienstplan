<script setup lang="ts">
import type { ReleaseNotificationStatusDto } from '#shared/types/api'
import { de } from '~/locales/de'

/** For the Leitung: who was told about changed duties at the latest release of this month, and who has read it. */
const props = defineProps<{ year: number; month: number }>()
const { data } = await useFetch<ReleaseNotificationStatusDto[]>(() => `/api/plan/${props.year}/${props.month}/notifications`)
</script>

<template>
  <p v-if="data?.length" class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
    <span class="font-medium">{{ de.notifications.statusTitle }}:</span>
    <span v-for="row in data" :key="row.employeeId" class="inline-flex items-center gap-1">
      <UIcon
        :name="!row.hasAccount ? 'i-lucide-user-x' : row.readAt ? 'i-lucide-check-check' : 'i-lucide-mail'"
        :class="!row.hasAccount ? 'text-gray-400' : row.readAt ? 'text-green-600' : 'text-amber-600'"
      />
      {{ row.name }} ({{ !row.hasAccount ? de.notifications.noAccount : row.readAt ? de.notifications.read : de.notifications.unread }})
    </span>
  </p>
</template>
