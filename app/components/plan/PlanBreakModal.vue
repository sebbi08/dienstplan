<script setup lang="ts">
import { parseTime, toTimeInput, validateSpan } from '#shared/domain/time'
import { de } from '~/locales/de'

/** 'change': edit the break of one entry (may be emptied); 'add': an additional break (required). */
const props = defineProps<{ mode: 'change' | 'add'; initial: { start: number; end: number } | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ submit: [value: { start: number; end: number } | null] }>()

const form = reactive({ start: '', end: '' })
const error = ref('')
const title = computed(() => (props.mode === 'change' ? de.modal.changeBreakTitle : de.modal.addBreakTitle))

watch(open, (isOpen) => {
  if (!isOpen) return
  form.start = props.initial ? toTimeInput(props.initial.start) : ''
  form.end = props.initial ? toTimeInput(props.initial.end) : ''
  error.value = ''
})

function submit() {
  if (!form.start && !form.end && props.mode === 'change') {
    emit('submit', null)
    open.value = false
    return
  }
  const start = parseTime(form.start)
  const end = parseTime(form.end)
  if (start === null || end === null) {
    error.value = de.spanErrors.missing_times
    return
  }
  const spanError = validateSpan({ start, end, breakStart: null, breakEnd: null })
  if (spanError) {
    error.value = de.spanErrors[spanError]
    return
  }
  emit('submit', { start, end })
  open.value = false
}
</script>

<template>
  <UModal v-model:open="open" :title="title">
    <template #body>
      <form class="grid grid-cols-2 gap-3" @submit.prevent="submit">
        <UFormField :label="de.modal.start"><UInput v-model="form.start" type="time" step="300" class="w-full" /></UFormField>
        <UFormField :label="de.modal.end"><UInput v-model="form.end" type="time" step="300" class="w-full" /></UFormField>
        <p v-if="mode === 'change'" class="col-span-2 text-xs text-gray-500">{{ de.modal.breakEmptyHint }}</p>
        <p v-if="error" class="col-span-2 text-sm text-red-600">{{ error }}</p>
        <div class="col-span-2 flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
          <UButton type="submit" :label="de.common.save" />
        </div>
      </form>
    </template>
  </UModal>
</template>
