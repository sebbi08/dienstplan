<script setup lang="ts">
import { autoDots, formatDateText, parseDateText } from '~/utils/dateText'
import { de } from '~/locales/de'

/**
 * A date typed as TT.MM.JJJJ (the dots come by themselves), with a calendar button for the native picker.
 * The model is the ISO date 'YYYY-MM-DD', or '' while the field is empty or holds no valid date.
 */
defineOptions({ inheritAttrs: false })
const props = defineProps<{ min?: string, max?: string, required?: boolean, disabled?: boolean }>()
const model = defineModel<string>({ required: true })
// `class` sizes the wrapper; everything else (id, aria-label, size …) goes to the input.
const attrs = useAttrs()
const inputAttrs = computed(() => {
  const { class: _class, ...rest } = attrs
  return rest
})

const text = ref(formatDateText(model.value))
const touched = ref(false)
const input = useTemplateRef<{ inputRef: HTMLInputElement | null }>('input')
const picker = useTemplateRef<HTMLInputElement>('picker')

const parsed = computed(() => parseDateText(text.value))
const inRange = (iso: string) => (!props.min || iso >= props.min) && (!props.max || iso <= props.max)
/** The ISO value the text stands for: '' when empty, invalid or outside min/max. */
const value = computed(() => (parsed.value && inRange(parsed.value) ? parsed.value : ''))

const hint = computed(() => {
  if (text.value.trim() === '') return ''
  if (!parsed.value) return de.common.invalidDate
  if (inRange(parsed.value)) return ''
  const min = formatDateText(props.min)
  const max = formatDateText(props.max)
  if (min && max) return de.common.dateBetween(min, max)
  return min ? de.common.dateFrom(min) : de.common.dateUntil(max)
})
const invalid = computed(() => touched.value && hint.value !== '')

// The browser refuses to submit the form while the text is no valid date (also for optional fields).
watchEffect(() => input.value?.inputRef?.setCustomValidity(hint.value))

watch(value, (iso) => {
  if (model.value !== iso) model.value = iso
})
watch(model, (iso) => {
  if (iso !== value.value) text.value = formatDateText(iso)
})

function onType(next: string | number | null | undefined) {
  const formatted = autoDots(text.value, String(next ?? ''))
  text.value = formatted
  // When autoDots drops a key the text stays the same, so Vue would leave the key in the field.
  const el = input.value?.inputRef
  if (el && el.value !== formatted) el.value = formatted
}

function onBlur() {
  touched.value = true
  if (value.value) text.value = formatDateText(value.value)
}

function openPicker() {
  const el = picker.value
  if (!el) return
  el.value = value.value
  try {
    el.showPicker()
  }
  catch {
    el.focus()
    el.click()
  }
}

function onPick(event: Event) {
  const iso = (event.target as HTMLInputElement).value
  if (!iso) return
  text.value = formatDateText(iso)
  touched.value = true
}
</script>

<template>
  <div :class="attrs.class">
    <div class="relative">
      <UInput
        ref="input" v-bind="inputAttrs" :model-value="text" type="text" inputmode="numeric" autocomplete="off" :maxlength="10"
        :placeholder="de.common.datePlaceholder" :required="required" :disabled="disabled" class="w-full"
        :color="invalid ? 'error' : 'primary'" :highlight="invalid" :aria-invalid="invalid || undefined"
        :ui="{ trailing: 'pe-1' }"
        @update:model-value="onType" @blur="onBlur"
      >
        <template #trailing>
          <UButton
            icon="i-lucide-calendar" color="neutral" variant="ghost" size="sm" :disabled="disabled"
            :aria-label="de.common.datePick" :title="de.common.datePick" @click="openPicker"
          />
        </template>
      </UInput>
      <input
        ref="picker" type="date" tabindex="-1" aria-hidden="true" :min="min" :max="max"
        class="pointer-events-none absolute right-0 bottom-0 h-px w-px opacity-0" @change="onPick"
      >
    </div>
    <p v-if="invalid" class="mt-0.5 text-xs text-red-600">{{ hint }}</p>
  </div>
</template>
