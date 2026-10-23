<script setup lang="ts">
import { PIN_LENGTH } from '#shared/domain/pin'
import { de } from '~/locales/de'

/**
 * The tablet's number pad for the six-digit PIN (stamping and unlocking the child records). The default slot sits
 * between the dots and the keys (e.g. for the error of the last try).
 */
const pin = defineModel<string>({ required: true })
const props = defineProps<{ busy: boolean }>()
defineEmits<{ back: [] }>()

function press(digit: string) {
  if (!props.busy && pin.value.length < PIN_LENGTH) pin.value += digit
}
</script>

<template>
  <div class="text-3xl tracking-[0.5em]" :aria-label="de.terminal.pin">{{ '•'.repeat(pin.length).padEnd(PIN_LENGTH, '–') }}</div>
  <slot />
  <div class="grid grid-cols-3 gap-2">
    <UButton v-for="digit in ['1', '2', '3', '4', '5', '6', '7', '8', '9']" :key="digit" size="xl" color="neutral" variant="outline" class="justify-center" :disabled="busy" :label="digit" @click="press(digit)" />
    <UButton size="xl" color="neutral" variant="ghost" class="justify-center" icon="i-lucide-delete" :disabled="busy" :aria-label="de.common.delete" @click="pin = pin.slice(0, -1)" />
    <UButton size="xl" color="neutral" variant="outline" class="justify-center" :disabled="busy" label="0" @click="press('0')" />
    <UButton size="xl" color="neutral" variant="ghost" class="justify-center" icon="i-lucide-x" :aria-label="de.terminal.back" @click="$emit('back')" />
  </div>
</template>
