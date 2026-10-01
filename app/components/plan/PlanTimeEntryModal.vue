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
  if ([form.start, form.end, form.breakStart, form.breakEnd].some(value => value.trim() && parseTime(value) === null)) {
    error.value = de.common.invalidTime
    return
  }
  const start = parseTime(form.start)
  const end = parseTime(form.end)
  if (start === null || end === null) {
    error.value = de.spanErrors.missing_times
    return
  }
  const breakStart = form.breakStart.trim() ? parseTime(form.breakStart) : null
  const breakEnd = form.breakEnd.trim() ? parseTime(form.breakEnd) : null
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
        <UFormField :label="de.modal.start"><TimeInput v-model="form.start" autofocus /></UFormField>
        <UFormField :label="de.modal.end"><TimeInput v-model="form.end" /></UFormField>
        <UFormField :label="de.modal.breakStart"><TimeInput v-model="form.breakStart" /></UFormField>
        <UFormField :label="de.modal.breakEnd"><TimeInput v-model="form.breakEnd" /></UFormField>
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
