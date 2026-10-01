<script setup lang="ts">
import { formatTime, isValidTimeInput, parseTime } from '#shared/domain/time'
import { de } from '~/locales/de'

/** Clock time typed on the keyboard ("8:45", "8.45", "845", "14" …), shown as h:mm after leaving the field. */
defineOptions({ inheritAttrs: false })
const model = defineModel<string>({ required: true })
// `class` sizes the wrapper; everything else (autofocus, @keydown …) goes to the input.
const attrs = useAttrs()
const inputAttrs = computed(() => {
  const { class: _class, ...rest } = attrs
  return rest
})
const touched = ref(false)
const invalid = computed(() => touched.value && model.value.trim() !== '' && !isValidTimeInput(model.value))

function normalize() {
  touched.value = true
  const minutes = parseTime(model.value)
  if (minutes !== null) model.value = formatTime(minutes)
}
</script>

<template>
  <div :class="attrs.class">
    <UInput
      v-model="model" v-bind="inputAttrs" type="text" inputmode="decimal" autocomplete="off" :maxlength="5"
      placeholder="hh:mm" class="w-full" :color="invalid ? 'error' : 'primary'" :highlight="invalid"
      :title="invalid ? de.common.invalidTime : undefined"
      @blur="normalize"
    />
    <p v-if="invalid" class="mt-0.5 text-xs text-red-600" :title="de.common.invalidTime">{{ de.common.invalidTimeShort }}</p>
  </div>
</template>
