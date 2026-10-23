<script setup lang="ts">
import { de } from '~/locales/de'

/** The form of a new meal, a change (name, time, „gilt ab“) or a removal („gilt ab“ only) in the meal settings. */
// `canSubmit`: something is typed (a new meal) or changed (name or time); a removal can always be sent.
defineProps<{ kind: 'add' | 'change' | 'remove'; busy: boolean; canSubmit: boolean; min: string }>()
const name = defineModel<string>('name', { required: true })
const time = defineModel<string>('time', { required: true })
const validFrom = defineModel<string>('validFrom', { required: true })
const emit = defineEmits<{ submit: []; cancel: [] }>()
const s = de.attendance
</script>

<template>
  <form class="flex flex-wrap items-end gap-2 rounded-md bg-gray-50 p-2" @submit.prevent="emit('submit')">
    <template v-if="kind !== 'remove'">
      <UFormField :label="s.mealName">
        <UInput v-model="name" maxlength="40" class="w-48" autofocus />
      </UFormField>
      <UFormField :label="s.mealTime">
        <TimeInput v-model="time" any-minute class="w-24" />
      </UFormField>
    </template>
    <UFormField :label="s.mealValidFrom">
      <UInput v-model="validFrom" type="date" :min="min" class="w-44" />
    </UFormField>
    <UButton
      type="submit" :color="kind === 'remove' ? 'error' : 'primary'" :label="kind === 'remove' ? s.mealRemove : kind === 'add' ? de.common.add : de.common.save"
      :loading="busy" :disabled="busy || !canSubmit"
    />
    <UButton color="neutral" variant="ghost" :label="de.common.cancel" :disabled="busy" @click="emit('cancel')" />
  </form>
</template>
