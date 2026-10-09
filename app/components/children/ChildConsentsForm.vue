<script setup lang="ts">
import type { ChildConsents, ChildRecordDto, ConsentKey } from '#shared/types/api'
import { de } from '~/locales/de'

/** Consents (Einwilligungen) of the parents, each ja / nein / offen; the open ones are grey. */
const props = defineProps<{ child: ChildRecordDto }>()
const emit = defineEmits<{ saved: [] }>()
const { busy, run } = useBusyAction(async () => emit('saved'))

const editing = ref(false)
const form = reactive<ChildConsents>({ ...props.child.consents })
const reset = () => Object.assign(form, props.child.consents)
// Another section's save refreshes the record; do not wipe what is being typed here.
watch(() => props.child.consents, () => { if (!editing.value) reset() })
watch(editing, (value) => { if (value) reset() })

async function save() {
  const ok = await run(() => $fetch<unknown>(`/api/children/${props.child.id}/consents`, { method: 'PUT', body: { ...form } }), de.common.saved)
  if (ok) editing.value = false
}
function cancel() {
  reset()
  editing.value = false
}

const privacyKeys: ConsentKey[] = ['artworkDisplay', 'photosDisplay', 'photosForeignPortfolios', 'photosInternalEvents', 'photosWhatsapp', 'photosNamesBirthdaysDisplay', 'groupWorkWithNames']
const whatsappKeys: ConsentKey[] = ['whatsappContact', 'whatsappPhotos', 'whatsappParentGroup']
// The ten consents split into the two blocks of the form sheet.
const blocks = [
  { key: 'privacy', title: de.children.consentGroups.privacy, keys: privacyKeys },
  { key: 'whatsapp', title: de.children.consentGroups.whatsapp, keys: whatsappKeys },
]
</script>

<template>
  <ChildrenChildSection v-model:editing="editing" :title="de.children.sections.consents" :stamp="child.stamps.consents" :can-edit="child.canEdit">
    <div class="grid gap-4 md:grid-cols-2">
      <div v-for="block in blocks" :key="block.key" class="space-y-1">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500">{{ block.title }}</h3>
        <ul class="divide-y divide-gray-100 text-sm">
          <li v-for="key in block.keys" :key="key" class="flex items-center justify-between gap-3 py-1.5">
            <span>{{ de.children.consents[key] }}</span>
            <ChildrenTriStateSelect :model-value="child.consents[key]" readonly />
          </li>
        </ul>
      </div>
    </div>

    <template #edit>
      <form class="space-y-4" @submit.prevent="save">
        <div class="grid gap-4 md:grid-cols-2">
          <div v-for="block in blocks" :key="block.key" class="space-y-1">
            <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500">{{ block.title }}</h3>
            <ul class="divide-y divide-gray-100 text-sm">
              <li v-for="key in block.keys" :key="key" class="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span>{{ de.children.consents[key] }}</span>
                <ChildrenTriStateSelect v-model="form[key]" :label="de.children.consents[key]" />
              </li>
            </ul>
          </div>
        </div>
        <div class="flex gap-2">
          <UButton type="submit" :label="de.common.save" :loading="busy" :disabled="busy" />
          <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" @click="cancel" />
        </div>
      </form>
    </template>
  </ChildrenChildSection>
</template>
