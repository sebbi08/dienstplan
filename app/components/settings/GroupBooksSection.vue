<script setup lang="ts">
import { de } from '~/locales/de'

/** Leitung and Träger: which groups of the active facility the staff of a group may also read at the tablet. */
const { data: groups } = useGroups()
</script>

<template>
  <section class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ de.groups.groupBooks }}</h2>
    <p class="text-xs text-gray-500">{{ de.groups.groupBooksHint }}</p>
    <SettingsGroupReadAccess :groups="groups ?? []" source="/api/group-read-access" />
  </section>
</template>
