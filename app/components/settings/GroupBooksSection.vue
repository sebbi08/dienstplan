<script setup lang="ts">
import { de } from '~/locales/de'

/** Leitung and Träger, on the group's page: which other groups of the active facility its staff may also read at the tablet. */
defineProps<{ groupId: number }>()
const { data: groups } = useGroups()
</script>

<template>
  <section class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ de.settingsAreas.groupReadAccess }}</h2>
    <p class="text-xs text-gray-500">{{ de.settingsAreas.groupReadAccessHint }}</p>
    <SettingsGroupReadAccess :groups="groups ?? []" source="/api/group-read-access" :group-id="groupId" />
  </section>
</template>
