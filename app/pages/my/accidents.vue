<script setup lang="ts">
import { de } from '~/locales/de'

/**
 * „Meine Unfälle“: the accident reports about the signed-in employee (Unfallanzeigen, also those of the Leitung, to read);
 * they fill in one about themselves and change the ones they filled in, never delete. Prefilled with the own data. Only
 * with a linked employee (the menu shows the entry only then; the API answers 404 otherwise).
 */
useHead({ title: de.accidents.my.title })
const { user } = useUserSession()
// Unsaved answers ask before the page is left.
useUnsavedGuard()
</script>

<template>
  <div class="max-w-3xl space-y-4">
    <h1 class="text-2xl font-semibold">{{ de.accidents.my.title }}</h1>
    <p class="text-sm text-gray-500">{{ de.accidents.my.intro }}</p>
    <p v-if="user?.employeeId === null" class="text-sm text-gray-500">{{ de.accidents.my.noEmployee }}</p>
    <section v-else class="rounded-lg bg-white p-4 ring-1 ring-gray-200">
      <AccidentsAccidentList
        subject="employee" list-url="/api/my/accidents" form-base="/api/employee-accidents"
        attachment-base="/api/employee-accident-attachments" print-base="/print/accidents"
      />
    </section>
  </div>
</template>
