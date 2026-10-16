<script setup lang="ts">
import { de } from '~/locales/de'

/**
 * The fields of "Andere Person" in the "Geht" and the correction dialog (spec §3.4): the name of a person who is not
 * registered (required) and, freely, with whom it was agreed ("Rücksprache mit"). The stay is marked "nicht hinterlegt".
 */
const name = defineModel<string>('name', { required: true })
const confirmedWith = defineModel<string>('confirmedWith', { required: true })
const s = de.attendance.leave
</script>

<template>
  <div class="space-y-3 rounded-lg bg-gray-50 p-3 ring-1 ring-gray-200">
    <UFormField :label="s.otherName" required>
      <UInput v-model="name" size="xl" maxlength="100" class="w-full" autofocus />
    </UFormField>
    <UFormField :label="s.confirmedWith">
      <UInput v-model="confirmedWith" size="xl" maxlength="100" class="w-full" :placeholder="s.confirmedWithPlaceholder" />
    </UFormField>
    <p class="text-sm text-gray-600">{{ s.otherHint }}</p>
  </div>
</template>
