<script setup lang="ts">
import type { CodeDto } from '#shared/types/api'
import { de } from '~/locales/de'

/** Clicked employee day in the year calendar: enter Urlaub/ÜF/Krank/Fortbildung/Schule up to a date, or remove it. */
const props = defineProps<{ title: string; date: string; codes: CodeDto[]; hasAbsence: boolean }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ apply: [codeId: number | null, until: string] }>()

const until = ref('')
watch(open, (isOpen) => {
  if (isOpen) until.value = props.date
})

function choose(code: CodeDto | null) {
  emit('apply', code?.id ?? null, until.value || props.date)
}
</script>

<template>
  <UModal v-model:open="open" :title="title">
    <template #body>
      <div class="space-y-4">
        <UFormField :label="de.calendar.until" :hint="de.calendar.untilHint">
          <DateTextInput v-model="until" :label="de.calendar.until" :min="date" class="w-full" />
        </UFormField>
        <div class="flex flex-wrap gap-2">
          <UButton v-for="code in codes" :key="code.id" color="neutral" variant="soft" :label="code.label" @click="choose(code)" />
        </div>
        <div class="flex justify-between gap-2">
          <UButton v-if="hasAbsence" color="error" variant="ghost" icon="i-lucide-trash-2" :label="de.calendar.removeAbsence" @click="choose(null)" />
          <UButton class="ml-auto" color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
        </div>
      </div>
    </template>
  </UModal>
</template>
