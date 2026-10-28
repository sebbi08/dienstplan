<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import { de } from '~/locales/de'

/**
 * Asked when a service's times change: also give its existing shifts (from a date on) and templates the new times,
 * or use the new times for new entries only. Closing the dialog cancels saving.
 */
const open = defineModel<boolean>('open', { required: true })
defineProps<{ name: string }>()
const emit = defineEmits<{ choose: [applyFrom: string | null] }>()

const from = ref(todayIso())
watch(open, (isOpen) => {
  if (isOpen) from.value = todayIso()
})

function choose(applyFrom: string | null) {
  emit('choose', applyFrom)
  open.value = false
}
</script>

<template>
  <UModal v-model:open="open" :title="de.settings.shiftChangeTitle(name)">
    <template #body>
      <form class="space-y-3" @submit.prevent="from && choose(from)">
        <p class="text-sm">{{ de.settings.shiftChangeText }}</p>
        <UFormField :label="de.settings.shiftChangeFrom">
          <DateTextInput v-model="from" :label="de.settings.shiftChangeFrom" class="w-44" required />
        </UFormField>
        <p class="text-xs text-gray-500">{{ de.settings.shiftChangeHint }}</p>
        <div class="flex flex-wrap justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
          <UButton color="neutral" variant="outline" :label="de.settings.shiftChangeNewOnly" @click="choose(null)" />
          <UButton type="submit" :label="de.settings.shiftChangeApply" />
        </div>
      </form>
    </template>
  </UModal>
</template>
