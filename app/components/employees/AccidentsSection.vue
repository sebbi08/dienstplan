<script setup lang="ts">
import { de } from '~/locales/de'

/**
 * „Unfälle“ of the personnel file (tab „Nachweise“, Leitung/Träger with accidents.manage): the employee's accident reports
 * (Unfallanzeigen) to fill in, change, print and delete, prefilled with what the viewer may read. Loaded once the tab is
 * opened.
 */
const props = defineProps<{ employeeId: number; active: boolean }>()
const shown = ref(false)
watch(() => props.active, (active) => {
  if (active) shown.value = true
}, { immediate: true })
</script>

<template>
  <section class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <div>
      <h2 class="font-semibold">{{ de.accidents.section }}</h2>
      <p class="text-sm text-gray-500">{{ de.accidents.employeeHint }}</p>
    </div>
    <AccidentsAccidentList
      v-if="shown" subject="employee" :list-url="`/api/employees/${props.employeeId}/accidents`"
      form-base="/api/employee-accidents" attachment-base="/api/employee-accident-attachments" print-base="/print/accidents"
    />
  </section>
</template>
