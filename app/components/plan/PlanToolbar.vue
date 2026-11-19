<script setup lang="ts">
import { formatDuration, formatTime } from '#shared/domain/time'
import { shiftBreakCheck } from '#shared/domain/timeRecords'
import type { CodeDto, TemplateDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { buttonCodes, codeButtonLabel } from '~/utils/codes'
import { type CellScope, codesForScope, takesAbsences } from '~/utils/helpOuts'

/** Buttons for the selected cells (those that do not fit the selection's scope are disabled) and "Aushilfe hinzufügen". */
const props = withDefaults(defineProps<{
  templates: TemplateDto[]
  codes: CodeDto[]
  selectedCount: number
  scope?: CellScope
  /** Helpers come from other facilities: the button only exists with several of them. */
  severalFacilities?: boolean
  /** „Krank melden“ for an editor without the sick days right (the private codes are not among `codes`). */
  reportSick?: boolean
}>(), { scope: 'normal', severalFacilities: false, reportSick: false })
const codeButtons = computed(() => buttonCodes(props.codes))
const allowedCodes = computed(() => new Set(codesForScope(codeButtons.value, props.scope).map(code => code.id)))
/** Tooltip of a shift button: its name plus the working time of its fixed times and whether its break meets the law. */
function templateTitle(template: TemplateDto) {
  const { worked, required, ok } = shiftBreakCheck(template)
  const home = template.homeOffice ? ` · ${de.plan.homeOffice}` : ''
  return `${template.shortLabel} · ${template.label}${home} – ${de.modal.templateWorkTime(formatDuration(worked), required, ok)}`
}
const withShifts = computed(() => props.scope === 'normal' || props.scope === 'helper')
const emit = defineEmits<{
  template: [template: TemplateDto]; code: [code: CodeDto]; special: []; clear: []; addHelper: []; reportSick: []
}>()
</script>

<template>
  <div class="space-y-2 rounded-lg bg-white p-2 ring-1 ring-gray-200 print:hidden">
    <div class="flex flex-wrap items-center gap-1">
      <span class="mr-2 text-xs text-gray-500">{{ selectedCount ? de.plan.selected(selectedCount) : de.plan.selectHint }}</span>
      <UButton
        v-for="template in templates" :key="template.id" size="xs" color="neutral" variant="outline"
        :title="templateTitle(template)" :disabled="!withShifts"
        :label="`${formatTime(template.start)}–${formatTime(template.end)}`"
        :icon="template.homeOffice ? 'i-lucide-house' : undefined"
        @click="emit('template', template)"
      />
      <UButton
        v-if="severalFacilities" size="xs" color="neutral" variant="outline" icon="i-lucide-user-plus" class="ml-auto"
        :label="de.plan.addHelper" @click="emit('addHelper')"
      />
    </div>
    <div class="flex flex-wrap items-center gap-1">
      <UButton
        v-for="code in codeButtons" :key="code.id" size="xs" color="neutral" variant="soft"
        :disabled="!allowedCodes.has(code.id)" :label="codeButtonLabel(code)" @click="emit('code', code)"
      />
      <UButton
        v-if="reportSick" size="xs" color="neutral" variant="soft" icon="i-lucide-thermometer"
        :disabled="!takesAbsences(scope)" :label="de.plan.reportSick" :title="de.plan.reportSickHint" @click="emit('reportSick')"
      />
      <UButton size="xs" color="neutral" variant="soft" :disabled="!withShifts" :label="de.plan.special" @click="emit('special')" />
      <UButton
        size="xs" color="error" variant="ghost" icon="i-lucide-eraser" :disabled="!withShifts"
        :label="de.plan.clear" @click="emit('clear')"
      />
    </div>
  </div>
</template>
