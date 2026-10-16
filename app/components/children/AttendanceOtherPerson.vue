<script setup lang="ts">
import { sameName } from '#shared/domain/childAttendance'
import { de } from '~/locales/de'

/**
 * The fields of "Andere Person" in the "Geht" and the correction dialog (spec §3.4): the name of a person who is not
 * registered (required) and, freely, with whom it was agreed ("Rücksprache mit"). The stay is marked "nicht hinterlegt".
 * A name of a contact of the child without "darf abholen" is still allowed, with a yellow hint before saving.
 */
const props = defineProps<{ noPickupContacts: string[] }>()
const name = defineModel<string>('name', { required: true })
const confirmedWith = defineModel<string>('confirmedWith', { required: true })
const s = de.attendance.leave

const withoutRight = computed(() => sameName(props.noPickupContacts, name.value))
</script>

<template>
  <div class="space-y-3 rounded-lg bg-gray-50 p-3 ring-1 ring-gray-200">
    <UFormField :label="s.otherName" required>
      <UInput v-model="name" size="xl" maxlength="100" class="w-full" autofocus />
    </UFormField>
    <p v-if="withoutRight" class="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-amber-900 ring-1 ring-amber-300" role="status">
      <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-5 shrink-0" /><span>{{ s.noPickupRight(withoutRight) }}</span>
    </p>
    <UFormField :label="s.confirmedWith">
      <UInput v-model="confirmedWith" size="xl" maxlength="100" class="w-full" :placeholder="s.confirmedWithPlaceholder" />
    </UFormField>
    <p class="text-sm text-gray-600">{{ s.otherHint }}</p>
  </div>
</template>
