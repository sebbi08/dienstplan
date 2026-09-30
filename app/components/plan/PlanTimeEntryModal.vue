<script setup lang="ts">
import { parseTime, validateSpan } from '#shared/domain/time'
import type { CodeDto, EntryInput } from '#shared/types/api'
import { de } from '~/locales/de'

const props = defineProps<{ code: CodeDto | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ submit: [entry: EntryInput] }>()

const form = reactive({ start: '', end: '', breakStart: '', breakEnd: '', note: '' })
const error = ref('')
const title = computed(() => (props.code ? de.modal.codeTitle(props.code.label) : de.modal.specialTitle))

watch(open, (isOpen) => {
  if (!isOpen) return
  Object.assign(form, { start: '', end: '', breakStart: '', breakEnd: '', note: '' })
  error.value = ''
})

function submit() {
  const start = parseTime(form.start)
  const end = parseTime(form.end)
  if (start === null || end === null) {
    error.value = de.spanErrors.missing_times
    return
  }
  const breakStart = form.breakStart ? parseTime(form.breakStart) : null
  const breakEnd = form.breakEnd ? parseTime(form.breakEnd) : null
  const spanError = validateSpan({ start, end, breakStart, breakEnd })
  if (spanError) {
    error.value = de.spanErrors[spanError]
    return
  }
  const note = form.note.trim() || null
  emit('submit', props.code
    ? { kind: 'code', codeId: props.code.id, start, end, breakStart, breakEnd, note }
    : { kind: 'special', start, end, breakStart, breakEnd, note })
  open.value = false
}
</script>

<template>
  <UModal v-model:open="open" :title="title">
    <template #body>
      <form class="grid grid-cols-2 gap-3" @submit.prevent="submit">
        <UFormField :label="de.modal.start"><UInput v-model="form.start" type="time" step="300" class="w-full" /></UFormField>
        <UFormField :label="de.modal.end"><UInput v-model="form.end" type="time" step="300" class="w-full" /></UFormField>
        <UFormField :label="de.modal.breakStart"><UInput v-model="form.breakStart" type="time" step="300" class="w-full" /></UFormField>
        <UFormField :label="de.modal.breakEnd"><UInput v-model="form.breakEnd" type="time" step="300" class="w-full" /></UFormField>
        <UFormField :label="de.modal.note" class="col-span-2"><UInput v-model="form.note" maxlength="200" class="w-full" /></UFormField>
        <p v-if="error" class="col-span-2 text-sm text-red-600">{{ error }}</p>
        <div class="col-span-2 flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
          <UButton type="submit" :label="de.modal.save" />
        </div>
      </form>
    </template>
  </UModal>
</template>
