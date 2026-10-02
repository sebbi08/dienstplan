<script setup lang="ts">
import { worksOnWeekday } from '#shared/domain/targets'
import { de } from '~/locales/de'

/** Toggle buttons Mo–Fr for a working-day bitmask (bit 0 = Monday). */
const workdays = defineModel<number>({ required: true })

// Quick successive clicks must build on each other even before the parent has passed the new value back.
let pending: number | null = null
function toggle(index: number) {
  pending = (pending ?? workdays.value) ^ (1 << index)
  workdays.value = pending
  nextTick(() => {
    pending = null
  })
}
</script>

<template>
  <div class="flex gap-1" role="group" :aria-label="de.employees.workdays">
    <UButton
      v-for="(day, index) in de.weekdaysShort.slice(0, 5)" :key="day" size="sm" class="w-9 justify-center"
      :color="worksOnWeekday(workdays, index) ? 'primary' : 'neutral'" :variant="worksOnWeekday(workdays, index) ? 'solid' : 'outline'"
      :aria-pressed="worksOnWeekday(workdays, index)" :label="day" @click="toggle(index)"
    />
  </div>
</template>
