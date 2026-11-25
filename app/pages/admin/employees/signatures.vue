<script setup lang="ts">
import { de } from '~/locales/de'

/**
 * Mitarbeitende → „Unterschriften“ (signRequests.manage; formerly a tab of „Dokumente“, `/documents?tab=signatures` sends
 * here): on top „Wer muss noch unterschreiben?“ per person, below the sent requests with the status per person,
 * „Erinnern“, „Zurückziehen“ and deleting. The overdue ones are counted in the tab.
 */
useHead({ title: de.signRequests.pageTitle })
const tabs = useStaffAreaTabs()
</script>

<template>
  <div class="max-w-4xl space-y-4">
    <AreaTabs :tabs="tabs" />
    <h1 class="text-2xl font-semibold">{{ de.signRequests.pageTitle }}</h1>
    <SignRequestsOpenByPerson />
    <h2 class="pt-2 text-lg font-semibold">{{ de.signRequests.sentListTitle }}</h2>
    <SignRequestsOverview />
  </div>
</template>
