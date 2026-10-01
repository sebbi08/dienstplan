<script setup lang="ts">
import { parseTime, validateSpan } from '#shared/domain/time'
import { de } from '~/locales/de'

/** An additional break for the selected cells (changing a break goes through the entry's edit dialog). */
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ submit: [value: { start: number; end: number }] }>()

const form = reactive({ start: '', end: '' })
const error = ref('')

watch(open, (isOpen) => {
  if (!isOpen) return
  Object.assign(form, { start: '', end: '' })
  error.value = ''
})

function submit() {
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
  <UModal v-model:open="open" :title="de.modal.addBreakTitle">
    <template #body>
      <form class="grid grid-cols-2 gap-3" @submit.prevent="submit">
        <UFormField :label="de.modal.start"><TimeInput v-model="form.start" autofocus /></UFormField>
        <UFormField :label="de.modal.end"><TimeInput v-model="form.end" /></UFormField>
        <p v-if="error" class="col-span-2 text-sm text-red-600">{{ error }}</p>
        <div class="col-span-2 flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
          <UButton type="submit" :label="de.common.save" />
        </div>
      </form>
    </template>
  </UModal>
</template>
