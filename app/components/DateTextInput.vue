<script setup lang="ts">
import { autoDots, formatDateText, parseDateText, stripDateText } from '~/utils/dateText'
import { de } from '~/locales/de'

/**
 * A date typed as TT.MM.JJJJ (the dots come by themselves), with a calendar button for the native picker.
 * The model is the ISO date 'YYYY-MM-DD', or '' while the field is empty or holds no valid date.
 * `label` names the field for the calendar button („Geburtsdatum im Kalender wählen“). `ui` adds classes to the input's
 * slots, merged with the field's own (e.g. { base: 'min-h-11' } for a touch-sized field).
 * Known limit: setting the model from outside to the value it already has ('' → '') does not reset an invalid text;
 * all current forms unmount the field on cancel/close, so that cannot happen there.
 */
defineOptions({ inheritAttrs: false })
const props = defineProps<{
  min?: string, max?: string, required?: boolean, disabled?: boolean, label?: string, ui?: Record<string, string>
}>()
const model = defineModel<string>({ required: true })
// `class` sizes the wrapper; everything else (id, aria-label, size …) goes to the input.
const attrs = useAttrs()
const inputAttrs = computed(() => {
  const { class: _class, ...rest } = attrs
  return rest
})
const pickLabel = computed(() => {
  const name = props.label ?? (attrs['aria-label'] as string | undefined)
  return name ? de.common.datePickFor(name) : de.common.datePick
})

/** The input's own slot classes plus the caller's: classes of the same slot are joined, never replaced. */
const inputUi = computed(() => {
  const merged: Record<string, string> = { trailing: 'pe-1' }
  for (const [slot, classes] of Object.entries(props.ui ?? {})) merged[slot] = [merged[slot], classes].filter(Boolean).join(' ')
  return merged
})

const text = ref(formatDateText(model.value))
const touched = ref(false)
const hintId = useId()
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

// The browser refuses to submit the form while the text is no valid date (also for optional fields). aria-invalid and
// aria-describedby go straight onto the input: inside a UFormField, UInput would overwrite them with its own.
watchEffect(() => {
  const el = input.value?.inputRef
  if (!el) return
  el.setCustomValidity(hint.value)
  el.setAttribute('aria-invalid', invalid.value ? 'true' : 'false')
  const described = (el.getAttribute('aria-describedby') ?? '').split(' ').filter(id => id && id !== hintId)
  if (invalid.value) described.push(hintId)
  if (described.length) el.setAttribute('aria-describedby', described.join(' '))
  else el.removeAttribute('aria-describedby')
}, { flush: 'post' })

// Also on text changes: a stored date outside min/max starts with value '' and must be cleared once the text is edited.
watch([value, text], ([iso]) => {
  if (model.value !== iso) model.value = iso
})
watch(model, (iso) => {
  if (iso !== value.value) text.value = formatDateText(iso)
})

function onType(next: string | number | null | undefined) {
  const raw = String(next ?? '')
  const el = input.value?.inputRef
  const caret = el?.selectionStart ?? raw.length
  const formatted = autoDots(text.value, raw, caret)
  text.value = formatted
  if (!el || el.value === formatted) return
  // When autoDots drops a key the text stays the same, so Vue would leave the key in the field.
  el.value = formatted
  // An edit in the middle only drops characters: keep the caret where it was, minus what was dropped before it.
  if (caret < raw.length) {
    const kept = stripDateText(raw.slice(0, caret)).length
    el.setSelectionRange(kept, kept)
  }
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
        :color="invalid ? 'error' : 'primary'" :highlight="invalid"
        :ui="inputUi"
        @update:model-value="onType" @blur="onBlur" @invalid="touched = true"
      >
        <template #trailing>
          <UButton
            icon="i-lucide-calendar" color="neutral" variant="ghost" size="sm" :disabled="disabled"
            :aria-label="pickLabel" :title="pickLabel" @click="openPicker"
          />
        </template>
      </UInput>
      <input
        ref="picker" type="date" tabindex="-1" aria-hidden="true" :min="min" :max="max"
        class="pointer-events-none absolute right-0 bottom-0 h-px w-px opacity-0" @change="onPick"
      >
    </div>
    <p v-if="invalid" :id="hintId" role="alert" class="mt-0.5 text-xs text-red-600">{{ hint }}</p>
  </div>
</template>
