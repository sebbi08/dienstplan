<script setup lang="ts">
import { formatTime } from '#shared/domain/time'
import type { CodeDto, TemplateDto } from '#shared/types/api'
import { de } from '~/locales/de'

defineProps<{
  templates: TemplateDto[]
  codes: CodeDto[]
  selectedCount: number
  gapSuggestion: { start: number; end: number; shortLabel: string } | null
}>()
const addMode = defineModel<boolean>('addMode', { default: false })
const emit = defineEmits<{
  template: [template: TemplateDto]; code: [code: CodeDto]; special: []; clear: []; fillGap: []; changeBreak: []; addBreak: []
}>()
</script>

<template>
  <div class="space-y-2 rounded-lg bg-white p-2 ring-1 ring-gray-200 print:hidden">
    <div class="flex flex-wrap items-center gap-1">
      <span class="mr-2 text-xs text-gray-500">{{ selectedCount ? de.plan.selected(selectedCount) : de.plan.selectHint }}</span>
      <UButton
        v-for="template in templates" :key="template.id" size="xs" color="neutral" variant="outline"
        :title="`${template.shortLabel} · ${template.label}`"
        :label="`${formatTime(template.start)}–${formatTime(template.end)}`"
        @click="emit('template', template)"
      />
    </div>
    <div class="flex flex-wrap items-center gap-1">
      <UButton
        v-for="code in codes" :key="code.id" size="xs" color="neutral" variant="soft"
        :label="code.requiresTimes ? `${code.label}…` : code.label" @click="emit('code', code)"
      />
      <UButton size="xs" color="neutral" variant="soft" :label="de.plan.special" @click="emit('special')" />
      <UButton size="xs" color="error" variant="soft" :label="de.plan.changeBreak" @click="emit('changeBreak')" />
      <UButton size="xs" color="error" variant="soft" :label="de.plan.addBreak" @click="emit('addBreak')" />
      <UButton size="xs" color="error" variant="ghost" icon="i-lucide-eraser" :label="de.plan.clear" @click="emit('clear')" />
      <UButton
        v-if="gapSuggestion" size="xs" color="warning" variant="soft"
        :label="de.plan.fillGap(`${gapSuggestion.shortLabel} ${formatTime(gapSuggestion.start)}–${formatTime(gapSuggestion.end)}`.trim())"
        @click="emit('fillGap')"
      />
      <UCheckbox v-model="addMode" :label="de.plan.addMode" class="ml-auto" />
    </div>
  </div>
</template>
