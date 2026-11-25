<script setup lang="ts">
import { de } from '~/locales/de'

/**
 * „Bewerbungen & Hospitationen“ on their own: for whoever sees the applicants without the staff list (e.g. a
 * Gruppenleitung with visits.applicants.view). With the staff list it is the tab of Mitarbeiter.
 */
useHead({ title: de.visits.tabs.applicants })
const { can } = useCan()
if (can('employees.view')) await navigateTo({ path: '/admin/employees', query: { tab: 'applicants' } }, { replace: true })
</script>

<template>
  <div class="max-w-5xl space-y-4">
    <h1 class="text-2xl font-semibold">{{ de.visits.tabs.applicants }}</h1>
    <VisitsApplicantList />
  </div>
</template>
