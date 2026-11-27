<script setup lang="ts">
import { formatDuration, formatTime } from '#shared/domain/time'
import { shiftBreakCheck } from '#shared/domain/timeRecords'
import type { CodeDto, TemplateDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { buttonCodes, codeButtonLabel } from '~/utils/codes'
import { type CellScope, codesForScope, takesAbsences } from '~/utils/helpOuts'

/**
 * Buttons for the selected cells (those that do not fit the selection's scope are disabled) and "Aushilfe hinzufügen".
 * `inline`: the plan's editing view – no box of its own, the buttons flow in the header row (PlanHeader) and the long
 * selection hint becomes an info icon with the hint as tooltip and name (on very wide screens the text itself); there the
 * buttons are a named group among the row's other buttons (a group, not an ARIA toolbar: no arrow-key navigation).
 */
const props = withDefaults(defineProps<{
  templates: TemplateDto[]
  codes: CodeDto[]
  selectedCount: number
  scope?: CellScope
  /** Helpers come from other facilities: the button only exists with several of them. */
  severalFacilities?: boolean
  /** „Krank melden“ for an editor without the sick days right (the private codes are not among `codes`). */
  reportSick?: boolean
  inline?: boolean
}>(), { scope: 'normal', severalFacilities: false, reportSick: false, inline: false })
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
  <div
    :class="inline ? 'contents' : 'block space-y-2 rounded-lg bg-white p-2 ring-1 ring-gray-200'" class="print:hidden"
    :role="inline ? 'group' : undefined" :aria-label="inline ? de.plan.toolbarLabel : undefined"
  >
    <div :class="inline ? 'contents' : 'flex flex-wrap items-center gap-1'">
      <span v-if="!inline || selectedCount" class="mr-2 text-xs text-gray-500" :class="inline && selectedCount ? 'font-medium text-sky-800' : ''">
        {{ selectedCount ? de.plan.selected(selectedCount) : de.plan.selectHint }}
      </span>
      <template v-else>
        <span class="hidden max-w-md text-xs text-gray-500 min-[1800px]:inline">{{ de.plan.selectHint }}</span>
        <UIcon
          name="i-lucide-mouse-pointer-click" class="size-4 shrink-0 text-gray-400 min-[1800px]:hidden" role="img"
          :aria-label="de.plan.selectHint" :title="de.plan.selectHint"
        />
      </template>
      <UButton
        v-for="template in templates" :key="template.id" size="xs" color="neutral" variant="outline"
        :title="templateTitle(template)" :disabled="!withShifts"
        :label="`${formatTime(template.start)}–${formatTime(template.end)}`"
        :icon="template.homeOffice ? 'i-lucide-house' : undefined"
        @click="emit('template', template)"
      />
      <UButton
        v-if="!inline && severalFacilities" size="xs" color="neutral" variant="outline" icon="i-lucide-user-plus" class="ml-auto"
        :label="de.plan.addHelper" @click="emit('addHelper')"
      />
    </div>
    <div :class="inline ? 'contents' : 'flex flex-wrap items-center gap-1'">
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
      <UButton
        v-if="inline && severalFacilities" size="xs" color="neutral" variant="outline" icon="i-lucide-user-plus"
        :label="de.plan.addHelper" @click="emit('addHelper')"
      />
    </div>
  </div>
</template>
