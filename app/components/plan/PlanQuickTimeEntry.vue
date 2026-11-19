<script setup lang="ts">
import type { EntryInput } from '#shared/types/api'
import { de } from '~/locales/de'
import { quickEntryInput } from '~/utils/quickEntry'

/**
 * The small field at a plan or template cell (double click, long press, Enter or F2): „7:30-14:00“ or
 * „7:30-14 P 11:30-12“ is sent as the special shift the „Sonderdienst“ dialog makes, on the dialog's way (`submit`).
 * Enter saves, Esc cancels; what is wrong shows under the field and the field stays open. The cell gets the focus back.
 */
const props = defineProps<{ reference: HTMLElement | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ submit: [entry: EntryInput] }>()

const text = ref('')
const error = ref('')
const fieldId = useId()

watch(open, (isOpen) => {
  if (!isOpen) return
  text.value = ''
  error.value = ''
})

function submit() {
  const result = quickEntryInput(text.value)
  if ('error' in result) {
    error.value = result.error
    return
  }
  open.value = false
  emit('submit', result.entry)
}

function backToCell(event: Event) {
  event.preventDefault()
  props.reference?.focus({ preventScroll: true })
}
</script>

<template>
  <UPopover
    v-model:open="open" :reference="reference ?? undefined"
    :content="{ side: 'bottom', align: 'start', sideOffset: 4, collisionPadding: 8, onCloseAutoFocus: backToCell }"
  >
    <template #content>
      <form class="w-64 space-y-1 p-2" @submit.prevent="submit">
        <label :for="fieldId" class="block text-xs font-medium text-gray-700">{{ de.quickEntry.label }}</label>
        <UInput
          :id="fieldId" v-model="text" autofocus autocomplete="off" maxlength="40" class="w-full"
          :placeholder="de.quickEntry.placeholder" :color="error ? 'error' : 'primary'" :highlight="!!error"
          :aria-invalid="!!error" :aria-describedby="`${fieldId}-help`" @update:model-value="error = ''"
        />
        <p v-if="error" :id="`${fieldId}-help`" class="text-xs text-red-600" role="alert">{{ error }}</p>
        <p v-else :id="`${fieldId}-help`" class="text-[11px] text-gray-500">{{ de.quickEntry.help }}</p>
      </form>
    </template>
  </UPopover>
</template>
