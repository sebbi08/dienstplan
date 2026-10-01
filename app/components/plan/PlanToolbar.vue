<script setup lang="ts">
import { formatTime } from '#shared/domain/time'
import type { CodeDto, TemplateDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { buttonCodes, codeButtonLabel } from '~/utils/codes'

const props = defineProps<{
  templates: TemplateDto[]
  codes: CodeDto[]
  selectedCount: number
}>()
const codeButtons = computed(() => buttonCodes(props.codes))
const addMode = defineModel<boolean>('addMode', { default: false })
const emit = defineEmits<{
  template: [template: TemplateDto]; code: [code: CodeDto]; special: []; clear: []; addBreak: []
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
        v-for="code in codeButtons" :key="code.id" size="xs" color="neutral" variant="soft"
        :label="codeButtonLabel(code)" @click="emit('code', code)"
      />
      <UButton size="xs" color="neutral" variant="soft" :label="de.plan.special" @click="emit('special')" />
      <UButton size="xs" color="error" variant="soft" :label="de.plan.addBreak" @click="emit('addBreak')" />
      <UButton size="xs" color="error" variant="ghost" icon="i-lucide-eraser" :label="de.plan.clear" @click="emit('clear')" />
      <UCheckbox v-model="addMode" :label="de.plan.addMode" class="ml-auto" />
    </div>
  </div>
</template>
