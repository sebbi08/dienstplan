<script setup lang="ts">
import { formatTime } from '#shared/domain/time'
import type { CodeDto, TemplateDto } from '#shared/types/api'
import type { GapSuggestion } from '~/components/plan/PlanToolbar.vue'
import { de } from '~/locales/de'
import { buttonCodes, codeButtonLabel } from '~/utils/codes'

/** Drop-down next to the clicked cell with everything that can be entered into the selected cells. */
const props = defineProps<{
  reference: HTMLElement | null
  templates: TemplateDto[]
  codes: CodeDto[]
  selectedCount: number
  gapSuggestions: GapSuggestion[]
}>()
const open = defineModel<boolean>('open', { required: true })
const addMode = defineModel<boolean>('addMode', { default: false })
const emit = defineEmits<{
  template: [template: TemplateDto]; code: [code: CodeDto]; special: []; clear: []
  fillGap: [suggestion: GapSuggestion]; changeBreak: []; addBreak: []
}>()

const codeButtons = computed(() => buttonCodes(props.codes))
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

        <section v-if="gapSuggestions.length">
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

        <section>
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

        <section>
          <h3 :class="heading">{{ de.plan.menuCodes }}</h3>
          <div class="flex flex-wrap gap-1">
            <UButton
              v-for="code in codeButtons" :key="code.id" size="xs" color="neutral" variant="soft"
              :label="codeButtonLabel(code)" @click="emit('code', code)"
            />
          </div>
        </section>

        <section>
          <h3 :class="heading">{{ de.plan.menuMore }}</h3>
          <div class="flex flex-wrap gap-1">
            <UButton size="xs" color="neutral" variant="soft" :label="de.plan.special" @click="emit('special')" />
            <UButton size="xs" color="error" variant="soft" :label="de.plan.changeBreak" @click="emit('changeBreak')" />
            <UButton size="xs" color="error" variant="soft" :label="de.plan.addBreak" @click="emit('addBreak')" />
            <UButton size="xs" color="error" variant="ghost" icon="i-lucide-eraser" :label="de.plan.clear" @click="emit('clear')" />
          </div>
        </section>

        <UCheckbox v-model="addMode" :label="de.plan.addMode" />
      </div>
    </template>
  </UPopover>
</template>
