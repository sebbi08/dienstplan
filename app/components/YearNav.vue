<script setup lang="ts">
import { de } from '~/locales/de'

const year = defineModel<number>({ required: true })
</script>

<template>
  <div class="flex items-center gap-1">
    <UButton icon="i-lucide-chevron-left" color="neutral" variant="ghost" :aria-label="de.common.previousYear" @click="year--" />
    <span class="min-w-16 text-center text-lg font-semibold">{{ year }}</span>
    <UButton icon="i-lucide-chevron-right" color="neutral" variant="ghost" :aria-label="de.common.nextYear" @click="year++" />
  </div>
</template>
