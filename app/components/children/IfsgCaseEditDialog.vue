<script setup lang="ts">
import { earliestReadmission, ifsgDateRule, ifsgDisease, type IfsgKind } from '#shared/domain/ifsg'
import type { IsoDate } from '#shared/domain/types'
import type { IfsgCaseUpdateInput, IfsgRulesDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { ifsgEarliestText } from '~/utils/ifsg'

/**
 * „Angaben ändern“ of a § 34 IfSG case (Leitung/Träger, the child's own group): the onset, the date rule and its date –
 * e.g. the antibiotic start that was not known when the case was entered. A rule left as it was keeps its snapshot
 * (server); a newly chosen one is taken from today's rules.
 */
const props = defineProps<{
  caseId: number; name: string; disease: string; kind: IfsgKind; reportedOn: IsoDate; onsetDate: IsoDate; ruleVariant: string | null
  ruleDate: IsoDate | null; reload: () => Promise<unknown>
}>()
const open = defineModel<boolean>('open', { default: false })
const { busy, run } = useBusyAction(() => props.reload())
const s = de.ifsg

const { data: rules } = await useFetch<IfsgRulesDto>('/api/ifsg/rules', { key: 'ifsg-rules', lazy: true })
const form = reactive<{ onsetDate: IsoDate; ruleVariant: string | null; ruleDate: IsoDate }>({ onsetDate: '', ruleVariant: null, ruleDate: '' })
watch(open, (value) => {
  if (value) Object.assign(form, { onsetDate: props.onsetDate, ruleVariant: props.ruleVariant, ruleDate: props.ruleDate ?? '' })
}, { immediate: true })

const diseaseRule = computed(() => (rules.value ? ifsgDisease(rules.value.diseases, props.disease) : null))
const dateRules = computed(() => diseaseRule.value?.kinds[props.kind]?.rules ?? [])
/** The chosen rule in today's rules (a rule no longer offered stays chosen; its date can still be changed). */
const rule = computed(() => (diseaseRule.value && form.ruleVariant !== null ? ifsgDateRule(diseaseRule.value, props.kind, form.ruleVariant) : null))
const needsRuleDate = computed(() => form.ruleVariant !== null && rule.value?.anchor !== 'onset')
const earliest = computed(() => earliestReadmission(rule.value, form.onsetDate, needsRuleDate.value && form.ruleDate ? form.ruleDate : null))
const valid = computed(() => form.onsetDate !== '' && form.onsetDate <= props.reportedOn)

async function save() {
  if (!valid.value) return
  const body: IfsgCaseUpdateInput = {
    onsetDate: form.onsetDate, ruleDate: needsRuleDate.value && form.ruleDate ? form.ruleDate : null,
    ...(form.ruleVariant !== props.ruleVariant ? { ruleVariant: form.ruleVariant } : {}),
  }
  if (await run(() => $fetch<{ ok: boolean }>(`/api/ifsg/cases/${props.caseId}`, { method: 'PUT', body }), s.edit.saved)) open.value = false
}
</script>

<template>
  <UModal v-model:open="open" :title="s.edit.title(name)">
    <template #body>
      <form class="space-y-4" @submit.prevent="save">
        <UFormField :label="s.case.onset[kind]" required>
          <DateTextInput v-model="form.onsetDate" :label="s.case.onset[kind]" size="xl" :max="reportedOn" required />
        </UFormField>
        <fieldset v-if="dateRules.length">
          <legend class="mb-1 text-sm font-medium">{{ s.case.rule }}</legend>
          <div class="flex flex-wrap gap-2" role="radiogroup">
            <UButton
              v-for="entry in dateRules" :key="entry.key" type="button" size="lg" role="radio" :aria-checked="form.ruleVariant === entry.key"
              :variant="form.ruleVariant === entry.key ? 'solid' : 'outline'" :color="form.ruleVariant === entry.key ? 'primary' : 'neutral'"
              :label="entry.label || s.anchors[entry.anchor]" @click="form.ruleVariant = entry.key"
            />
            <UButton
              type="button" size="lg" role="radio" :aria-checked="form.ruleVariant === null"
              :variant="form.ruleVariant === null ? 'solid' : 'outline'" :color="form.ruleVariant === null ? 'primary' : 'neutral'"
              :label="s.case.ruleUnknown" @click="form.ruleVariant = null"
            />
          </div>
        </fieldset>
        <UFormField v-if="needsRuleDate" :label="rule ? s.anchors[rule.anchor] : s.case.rule">
          <DateTextInput v-model="form.ruleDate" :label="rule ? s.anchors[rule.anchor] : s.case.rule" size="xl" />
        </UFormField>
        <p v-if="rule" class="text-sm font-medium">{{ ifsgEarliestText(earliest, rule.condition) }}</p>
        <div class="flex flex-wrap gap-2">
          <UButton type="submit" size="xl" :label="de.common.save" :loading="busy" :disabled="busy || !valid" />
          <UButton type="button" size="xl" color="neutral" variant="ghost" :label="de.common.cancel" :disabled="busy" @click="open = false" />
        </div>
      </form>
    </template>
  </UModal>
</template>
