<script setup lang="ts">
import type { ChildRecordDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { orNull } from '~/utils/children'
import { formatDate } from '~/utils/format'

/** Health (Gesundheit): measles proof, infection briefing, allergies and what the staff may do. */
/** `reload` re-reads the record; the busy flag stays on until it is done, so the next action works on fresh data. */
const props = defineProps<{ child: ChildRecordDto; reload: () => Promise<unknown> }>()
const { busy, run } = useBusyAction(() => props.reload())

const editing = ref(false)
const form = reactive({ ...props.child.health, measlesProofDate: '', infectionBriefingDate: '' })
function reset() {
  const health = props.child.health
  Object.assign(form, { ...health, measlesProofDate: health.measlesProofDate ?? '', infectionBriefingDate: health.infectionBriefingDate ?? '' })
}
reset()
// Another section's save refreshes the record; do not wipe what is being typed here.
watch(() => props.child.health, () => { if (!editing.value) reset() })
watch(editing, (value) => { if (value) reset() })

async function save() {
  const body = { ...form, measlesProofDate: orNull(form.measlesProofDate), infectionBriefingDate: orNull(form.infectionBriefingDate) }
  const ok = await run(() => $fetch<unknown>(`/api/children/${props.child.id}/health`, { method: 'PUT', body }), de.common.saved)
  if (ok) editing.value = false
}
function cancel() {
  reset()
  editing.value = false
}

const f = de.children.fields
const permissions = [
  { key: 'mayTakeTemperature', label: f.mayTakeTemperature },
  { key: 'mayApplySunscreen', label: f.mayApplySunscreen },
  { key: 'mayApplyPlaster', label: f.mayApplyPlaster },
] as const
</script>

<template>
  <ChildrenChildSection v-model:editing="editing" :title="de.children.sections.health" :stamp="child.stamps.health" :can-edit="child.canEdit">
    <template #banner><ChildrenReviewBanner :child="child" section="health" :reload="reload" /></template>

    <dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      <div>
        <dt class="text-xs text-gray-500">{{ f.measlesProof }}</dt>
        <dd>
          <ChildrenTriStateSelect :model-value="child.health.measlesProof" readonly />
          <span v-if="child.health.measlesProofDate" class="ml-2">{{ formatDate(child.health.measlesProofDate) }}</span>
        </dd>
      </div>
      <div>
        <dt class="text-xs text-gray-500">{{ f.infectionBriefingDate }}</dt>
        <dd>{{ child.health.infectionBriefingDate ? formatDate(child.health.infectionBriefingDate) : de.children.noValue }}</dd>
      </div>
      <div class="sm:col-span-2">
        <dt class="text-xs text-gray-500">{{ f.allergiesText }}</dt>
        <dd class="whitespace-pre-line">{{ child.health.allergies || de.children.noValue }}</dd>
      </div>
      <div v-for="permission in permissions" :key="permission.key">
        <dt class="text-xs text-gray-500">{{ permission.label }}</dt>
        <dd><ChildrenTriStateSelect :model-value="child.health[permission.key]" readonly /></dd>
      </div>
    </dl>

    <template #edit>
      <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="save">
        <UFormField :label="f.measlesProof"><ChildrenTriStateSelect v-model="form.measlesProof" :label="f.measlesProof" /></UFormField>
        <UFormField :label="f.measlesProofDate"><DateTextInput v-model="form.measlesProofDate" class="w-full" /></UFormField>
        <UFormField :label="f.infectionBriefingDate"><DateTextInput v-model="form.infectionBriefingDate" class="w-full" /></UFormField>
        <UFormField :label="f.allergiesText" class="sm:col-span-2"><UTextarea v-model="form.allergies" :rows="3" maxlength="2000" class="w-full" /></UFormField>
        <UFormField v-for="permission in permissions" :key="permission.key" :label="permission.label">
          <ChildrenTriStateSelect v-model="form[permission.key]" :label="permission.label" />
        </UFormField>
        <div class="flex gap-2 sm:col-span-2">
          <UButton type="submit" :label="de.common.save" :loading="busy" :disabled="busy" />
          <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" @click="cancel" />
        </div>
      </form>
    </template>
  </ChildrenChildSection>
</template>
