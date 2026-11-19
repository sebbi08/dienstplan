<script setup lang="ts">
import { earliestReadmission, ifsgDateRule, ifsgDisease, ifsgKinds, type IfsgKind } from '#shared/domain/ifsg'
import type { IsoDate } from '#shared/domain/types'
import type { AttendanceChildDto, IfsgCaseInput, IfsgRulesDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { ifsgEarliestText } from '~/utils/ifsg'

/**
 * „Meldepflichtige Krankheit (§ 34 IfSG)“ for a child of the own group on the shown day: the disease, its kind (only
 * those table 1 allows), the onset and the date rule with the date it counts from. Shows the readmission text, the
 * proof and the earliest day while choosing. Saving books the day's absence as well (server).
 */
const props = defineProps<{ child: AttendanceChildDto; date: IsoDate; reload: () => Promise<unknown> }>()
const open = defineModel<boolean>('open', { default: false })
const { busy, run } = useBusyAction(() => props.reload())
const s = de.ifsg

const { data: rules } = await useFetch<IfsgRulesDto>('/api/ifsg/rules', { key: 'ifsg-rules', lazy: true })

const form = reactive<{ disease: string; kind: IfsgKind; onsetDate: IsoDate; ruleVariant: string | null; ruleDate: IsoDate }>({
  disease: '', kind: 'sick', onsetDate: props.date, ruleVariant: null, ruleDate: '',
})
watch(open, (value) => {
  if (value) Object.assign(form, { disease: '', kind: 'sick', onsetDate: props.date, ruleVariant: null, ruleDate: '' })
}, { immediate: true })

const diseaseItems = computed(() => (rules.value?.diseases ?? []).map(entry => ({ label: entry.name, value: entry.key }))
  .sort((a, b) => a.label.localeCompare(b.label, 'de')))
const disease = computed(() => (rules.value ? ifsgDisease(rules.value.diseases, form.disease) : null))
const kinds = computed(() => (disease.value ? ifsgKinds(disease.value) : []))
const kindRule = computed(() => disease.value?.kinds[form.kind] ?? null)
const dateRules = computed(() => kindRule.value?.rules ?? [])
const rule = computed(() => (disease.value && form.ruleVariant !== null ? ifsgDateRule(disease.value, form.kind, form.ruleVariant) : null))

// A new disease starts with its first kind and, with a single date rule, that rule; a new kind drops a rule it lacks.
watch(() => form.disease, () => {
  form.kind = kinds.value[0] ?? 'sick'
})
watch([() => form.disease, () => form.kind], () => {
  form.ruleVariant = dateRules.value.length === 1 ? dateRules.value[0]!.key : null
  form.ruleDate = ''
})

const needsRuleDate = computed(() => rule.value !== null && rule.value.anchor !== 'onset')
const earliest = computed(() => earliestReadmission(rule.value, form.onsetDate, needsRuleDate.value && form.ruleDate ? form.ruleDate : null))
const valid = computed(() => disease.value !== null && kinds.value.includes(form.kind) && form.onsetDate !== '' && form.onsetDate <= props.date)

async function save() {
  if (!valid.value) return
  const body: IfsgCaseInput = {
    childId: props.child.childId, date: props.date, disease: form.disease, kind: form.kind, onsetDate: form.onsetDate,
    ruleVariant: form.ruleVariant, ruleDate: needsRuleDate.value && form.ruleDate ? form.ruleDate : null,
  }
  if (await run(() => $fetch<{ id: number }>('/api/ifsg/cases', { method: 'POST', body }), s.case.saved)) open.value = false
}
</script>

<template>
  <UModal v-model:open="open" :title="s.case.title(child.name)">
    <template #body>
      <form class="space-y-4" @submit.prevent="save">
        <UFormField :label="s.case.disease" required>
          <USelectMenu
            v-model="form.disease" :items="diseaseItems" value-key="value" size="xl" class="w-full"
            :placeholder="s.case.diseasePlaceholder" :aria-label="s.case.disease"
          />
        </UFormField>
        <fieldset v-if="kinds.length > 1">
          <legend class="mb-1 text-sm font-medium">{{ s.case.kind }}</legend>
          <div class="grid gap-2 sm:grid-cols-3" role="radiogroup">
            <UButton
              v-for="kind in kinds" :key="kind" type="button" size="lg" block role="radio" :aria-checked="form.kind === kind"
              :variant="form.kind === kind ? 'solid' : 'outline'" :color="form.kind === kind ? 'primary' : 'neutral'"
              :label="s.kinds[kind]" @click="form.kind = kind"
            />
          </div>
        </fieldset>
        <UFormField :label="s.case.onset[form.kind]" required>
          <DateTextInput v-model="form.onsetDate" :label="s.case.onset[form.kind]" size="xl" :max="date" required />
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
              v-if="dateRules.length > 1" type="button" size="lg" role="radio" :aria-checked="form.ruleVariant === null"
              :variant="form.ruleVariant === null ? 'solid' : 'outline'" :color="form.ruleVariant === null ? 'primary' : 'neutral'"
              :label="s.case.ruleUnknown" @click="form.ruleVariant = null"
            />
          </div>
        </fieldset>
        <UFormField v-if="rule && needsRuleDate" :label="s.anchors[rule.anchor]">
          <DateTextInput v-model="form.ruleDate" :label="s.anchors[rule.anchor]" size="xl" />
        </UFormField>

        <div
          v-if="kindRule" class="space-y-1 rounded-lg p-3 text-sm ring-1"
          :class="disease?.binding === false ? 'bg-amber-50 text-amber-900 ring-amber-200' : 'bg-red-50 text-red-900 ring-red-200'"
        >
          <p v-if="disease?.binding === false" class="font-semibold">{{ s.recommendation }}</p>
          <p class="font-semibold">{{ s.readmissionFrom(kindRule.source === 'local' ? s.sourceLocal(rules?.healthOffice.name ?? '') : s.sourceRki) }}</p>
          <p>{{ kindRule.text }}</p>
          <p class="font-medium">{{ ifsgEarliestText(earliest, rule?.condition) }}</p>
          <p>{{ s.proof(s.proofs[kindRule.proof]) }}</p>
        </div>
        <p class="text-sm text-gray-600">{{ s.case.absenceHint }}</p>
        <div class="flex flex-wrap gap-2">
          <UButton type="submit" size="xl" color="error" icon="i-lucide-shield-alert" :label="s.case.submit" :loading="busy" :disabled="busy || !valid" />
          <UButton type="button" size="xl" color="neutral" variant="ghost" :label="de.common.cancel" :disabled="busy" @click="open = false" />
        </div>
        <p class="text-xs text-gray-500">{{ s.footer }}</p>
      </form>
    </template>
  </UModal>
</template>
