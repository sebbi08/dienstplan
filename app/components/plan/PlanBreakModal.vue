<script setup lang="ts">
import { formatTime, parseTime, validateSpan } from '#shared/domain/time'
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
  form.start = props.initial ? formatTime(props.initial.start) : ''
  form.end = props.initial ? formatTime(props.initial.end) : ''
  error.value = ''
})

function submit() {
  if (!form.start.trim() && !form.end.trim() && props.mode === 'change') {
    emit('submit', null)
    open.value = false
    return
  }
  if ([form.start, form.end].some(value => value.trim() && parseTime(value) === null)) {
    error.value = de.common.invalidTime
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
        <UFormField :label="de.modal.start"><TimeInput v-model="form.start" autofocus /></UFormField>
        <UFormField :label="de.modal.end"><TimeInput v-model="form.end" /></UFormField>
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
