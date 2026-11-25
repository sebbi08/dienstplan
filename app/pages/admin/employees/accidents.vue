<script setup lang="ts">
import { de } from '~/locales/de'

/**
 * Mitarbeitende → „Unfälle“ (accidents.manage): the employees' accident reports of a year with the printable list. The
 * children's are the tab „Unfälle“ of Kinder; the former page Mehr → „Unfälle“ (/admin/accidents) sends to one of them.
 */
useHead({ title: de.nav.accidents })
const tabs = useStaffAreaTabs()
</script>

<template>
  <div class="max-w-5xl space-y-4">
    <AreaTabs :tabs="tabs" />
    <h1 class="text-2xl font-semibold">{{ de.nav.accidents }}</h1>
    <AccidentsYearList subject="employee" />
  </div>
</template>
