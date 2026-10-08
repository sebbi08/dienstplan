<script lang="ts">
/** A shift that fills up a day with VZ/Büro: a fixed shift (templateId) or a special shift (templateId null). */
export interface GapSuggestion {
  templateId: number | null
  start: number
  end: number
  shortLabel: string
}
</script>

<script setup lang="ts">
import { formatTime } from '#shared/domain/time'
import type { CodeDto, TemplateDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { buttonCodes, codeButtonLabel } from '~/utils/codes'
import { type CellScope, codesForScope } from '~/utils/helpOuts'

/**
 * Drop-down next to the clicked cell with everything that can be entered into the selected cells. A helper's cells take
 * no absences; a day on which someone helps out elsewhere takes only absences (scope, see cellScope).
 */
const props = withDefaults(defineProps<{
  reference: HTMLElement | null
  templates: TemplateDto[]
  codes: CodeDto[]
  selectedCount: number
  gapSuggestions: GapSuggestion[]
  scope?: CellScope
}>(), { scope: 'normal' })
const open = defineModel<boolean>('open', { required: true })
const addMode = defineModel<boolean>('addMode', { default: false })
const emit = defineEmits<{
  template: [template: TemplateDto]; code: [code: CodeDto]; special: []; clear: []
  fillGap: [suggestion: GapSuggestion]; addBreak: []
}>()

const codeButtons = computed(() => codesForScope(buttonCodes(props.codes), props.scope))
/** Shifts, special shifts, breaks and clearing: not on a day that another facility plans. */
const withShifts = computed(() => props.scope === 'normal' || props.scope === 'helper')
const scopeHint = computed(() => ({
  normal: null, helper: de.plan.menuHelperHint, marker: de.plan.menuMarkerHint, mixed: de.plan.menuMixedHint,
})[props.scope])
const range = (start: number, end: number) => `${formatTime(start)}–${formatTime(end)}`
const heading = 'mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500'
</script>

<template>
  <UPopover
    v-model:open="open" :reference="reference ?? undefined"
    :content="{ side: 'right', align: 'start', sideOffset: 4, collisionPadding: 8, onOpenAutoFocus: (event: Event) => event.preventDefault() }"
  >
    <template #content>
      <div class="max-h-[80dvh] w-64 space-y-3 overflow-y-auto p-2 text-sm">
        <p class="text-xs text-gray-500">{{ de.plan.selected(selectedCount) }}</p>
        <p v-if="scopeHint" class="text-xs text-gray-600">{{ scopeHint }}</p>

        <section v-if="withShifts && gapSuggestions.length">
          <h3 :class="heading">{{ de.plan.fillGap }}</h3>
          <div class="flex flex-wrap gap-1">
            <UButton
              v-for="suggestion in gapSuggestions" :key="`${suggestion.templateId}-${suggestion.start}`"
              size="xs" color="warning" variant="soft"
              :label="`${suggestion.shortLabel} ${range(suggestion.start, suggestion.end)}`.trim()"
              @click="emit('fillGap', suggestion)"
            />
          </div>
        </section>

        <section v-if="withShifts">
          <h3 :class="heading">{{ de.plan.menuShifts }}</h3>
          <div class="grid gap-0.5">
            <UButton
              v-for="template in templates" :key="template.id" size="xs" color="neutral" variant="ghost" class="justify-start"
              @click="emit('template', template)"
            >
              <span class="w-7 font-semibold">{{ template.shortLabel }}</span>
              <span class="tabular-nums">{{ range(template.start, template.end) }}</span>
            </UButton>
          </div>
        </section>

        <section v-if="codeButtons.length">
          <h3 :class="heading">{{ de.plan.menuCodes }}</h3>
          <div class="flex flex-wrap gap-1">
            <UButton
              v-for="code in codeButtons" :key="code.id" size="xs" color="neutral" variant="soft"
              :label="codeButtonLabel(code)" @click="emit('code', code)"
            />
          </div>
        </section>

        <section v-if="withShifts">
          <h3 :class="heading">{{ de.plan.menuMore }}</h3>
          <div class="flex flex-wrap gap-1">
            <UButton size="xs" color="neutral" variant="soft" :label="de.plan.special" @click="emit('special')" />
            <UButton size="xs" color="error" variant="soft" :label="de.plan.addBreak" @click="emit('addBreak')" />
            <UButton size="xs" color="error" variant="ghost" icon="i-lucide-eraser" :label="de.plan.clear" @click="emit('clear')" />
          </div>
        </section>

        <UCheckbox v-if="withShifts" v-model="addMode" :label="de.plan.addMode" />
      </div>
    </template>
  </UPopover>
</template>
