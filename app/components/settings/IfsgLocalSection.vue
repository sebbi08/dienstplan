<script setup lang="ts">
import { IFSG_ANCHORS, IFSG_PROOFS, type IfsgAnchor, type IfsgProof } from '#shared/domain/ifsg'
import type { IfsgDocumentDto, IfsgLocalRuleInput, IfsgLocalRulesDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { MAX_DOCUMENT_BYTES, formatSize } from '~/utils/children'
import { errorCode } from '~/utils/errors'
import { formatDate } from '~/utils/format'
import { ifsgDifferenceTexts, ifsgRulesText } from '~/utils/ifsg'

/**
 * Einstellungen → Kinder → „Wiederzulassung (Gesundheitsamt)“ (Leitung and Träger): the health office's documents,
 * the presets („RKI-Werte übernehmen“, the Rhein-Neckar-Kreis document), and per disease the RKI rule beside the local
 * one, marked „abweichend vom RKI“ with what differs; local diseases can be added. Empty fields follow the RKI.
 */
const l = de.ifsg.local
const f = l.form
const confirm = useConfirm()
const toast = useToast()
const { data, refresh } = await useFetch<IfsgLocalRulesDto>('/api/ifsg/local-rules', { key: 'ifsg-local-rules' })
const { data: documents, refresh: refreshDocuments } = await useFetch<IfsgDocumentDto[]>('/api/ifsg/documents', { key: 'ifsg-documents', default: () => [] })
const { busy, run } = useBusyAction(async () => {
  await refresh()
  await refreshDocuments()
})

// ---- presets ----
async function applyPreset(preset: 'rki' | 'rnk_2024') {
  const send = (overwrite: boolean) => $fetch<{ written: number }>('/api/ifsg/local-rules/preset', { method: 'POST', body: { preset, overwrite } })
  try {
    const { written } = await send(false)
    toast.add({ title: l.presetApplied(written), color: 'success' })
    await refresh()
  }
  catch (error) {
    if (errorCode(error) !== 'ifsg_local_exists') return void run(() => Promise.reject(error))
    if (!(await confirm(l.confirmOverwrite, { confirmLabel: l.overwrite }))) return
    let written = 0
    if (await run(async () => { written = (await send(true)).written })) toast.add({ title: l.presetApplied(written), color: 'success' })
  }
}

// ---- documents ----
const documentTitle = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const viewing = ref<IfsgDocumentDto | null>(null)
async function upload() {
  const file = fileInput.value?.files?.[0]
  if (!file) return void toast.add({ title: de.errors.file_required, color: 'error' })
  if (file.size > MAX_DOCUMENT_BYTES) return void toast.add({ title: de.errors.document_too_large, color: 'error' })
  const body = new FormData()
  body.append('file', file)
  body.append('title', documentTitle.value)
  if (await run(() => $fetch<{ id: number }>('/api/ifsg/documents', { method: 'POST', body }), de.common.saved)) {
    documentTitle.value = ''
    if (fileInput.value) fileInput.value.value = ''
  }
}
async function removeDocument(document: IfsgDocumentDto) {
  if (await confirm(l.confirmDeleteDocument)) run(() => $fetch<{ ok: boolean }>(`/api/ifsg/documents/${document.id}`, { method: 'DELETE' }), de.common.deleted)
}

// ---- the rules ----
type Row = IfsgLocalRulesDto['rows'][number]
type Tri = 'rki' | 'yes' | 'no'
const triOf = (value: boolean | null | undefined): Tri => (value === null || value === undefined ? 'rki' : value ? 'yes' : 'no')
const fromTri = (value: Tri): boolean | null => (value === 'rki' ? null : value === 'yes')
const triItems = [{ label: f.likeRki, value: 'rki' }, { label: f.yes, value: 'yes' }, { label: f.no, value: 'no' }]
const proofItems = computed(() => [
  ...(editing.value?.custom ? [] : [{ label: f.proofRki, value: 'rki' }]),
  ...IFSG_PROOFS.map(proof => ({ label: de.ifsg.proofs[proof], value: proof })),
])
const anchorItems = IFSG_ANCHORS.map(anchor => ({ label: de.ifsg.anchors[anchor], value: anchor }))

interface Form {
  name: string; notifiable: boolean; text: string; ownRules: boolean; rules: { anchor: IfsgAnchor; days: number; label: string; condition: string }[]
  proof: IfsgProof | 'rki'; notify: Tri; householdExclusion: Tri; householdText: string; note: string; hint: string
}
/** The row being edited (`custom`: a local disease; `key` null: a new one). */
const editing = ref<{ key: string | null; custom: boolean; row: Row | null } | null>(null)
const form = reactive<Form>({
  name: '', notifiable: false, text: '', ownRules: false, rules: [], proof: 'rki', notify: 'rki', householdExclusion: 'rki', householdText: '', note: '', hint: '',
})
const editOpen = computed({ get: () => editing.value !== null, set: (value: boolean) => { if (!value) editing.value = null } })

function openEdit(row: Row | null) {
  const local = row?.local ?? null
  const custom = row ? row.rki === null : true
  editing.value = { key: row?.key ?? null, custom, row }
  Object.assign(form, {
    name: local?.name ?? '', notifiable: local?.notifiable ?? false, text: local?.text ?? '', ownRules: local?.rules !== null && local?.rules !== undefined,
    rules: (local?.rules ?? []).map(rule => ({ ...rule, condition: rule.condition ?? '' })), proof: local?.proof ?? (custom ? 'none' : 'rki'), notify: triOf(local?.notify),
    householdExclusion: triOf(local?.householdExclusion), householdText: local?.householdText ?? '', note: local?.note ?? '', hint: local?.hint ?? '',
  })
}
function addRule() {
  form.ownRules = true
  if (form.rules.length < 3) form.rules.push({ anchor: 'onset', days: 1, label: '', condition: '' })
}

async function save() {
  const target = editing.value
  if (!target) return
  const body: IfsgLocalRuleInput = {
    ...(target.custom ? { name: form.name, notifiable: form.notifiable } : {}),
    text: form.text, rules: form.ownRules ? form.rules.map(rule => ({ ...rule, days: Number(rule.days) })) : null,
    proof: form.proof === 'rki' ? null : form.proof, notify: fromTri(form.notify), householdExclusion: fromTri(form.householdExclusion),
    householdText: form.householdText, note: form.note, hint: form.hint,
  }
  const ok = target.key === null
    ? await run(() => $fetch<{ key: string }>('/api/ifsg/local-rules', { method: 'POST', body }), de.common.saved)
    : await run(() => $fetch<{ ok: boolean }>(`/api/ifsg/local-rules/${target.key}`, { method: 'PUT', body }), de.common.saved)
  if (ok) editing.value = null
}
async function reset(row: Row) {
  const custom = row.rki === null
  if (await confirm(custom ? l.confirmRemove : l.confirmReset, { confirmLabel: custom ? l.remove : l.reset })) {
    run(() => $fetch<{ ok: boolean }>(`/api/ifsg/local-rules/${row.key}`, { method: 'DELETE' }), de.common.saved)
  }
}

const officeName = computed(() => data.value?.healthOffice.name ?? '')
</script>

<template>
  <section v-if="data" class="space-y-4 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ l.title }}</h2>
    <p class="text-sm text-gray-600">{{ l.intro }}</p>

    <!-- The health office's documents: viewable in the app, also at the tablet. -->
    <div class="space-y-2">
      <h3 class="text-sm font-semibold">{{ l.documents }}</h3>
      <p v-if="!documents?.length" class="text-sm text-gray-500">{{ l.noDocuments }}</p>
      <ul v-else class="divide-y divide-gray-100 rounded-md ring-1 ring-gray-200">
        <li v-for="document in documents" :key="document.id" class="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
          <button type="button" class="min-w-0 flex-1 text-left font-medium text-sky-700 hover:underline" @click="viewing = document">
            {{ document.title || l.documents }}
          </button>
          <span class="text-gray-500">{{ formatSize(document.size) }} · {{ formatDate(document.uploadedAt.slice(0, 10)) }}</span>
          <UButton size="sm" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" :disabled="busy" @click="removeDocument(document)" />
        </li>
      </ul>
      <ChildrenDocumentViewer
        v-if="viewing" :open="true" :document-id="viewing.id" :title="viewing.title" :mime-type="viewing.mimeType"
        :url="`/api/ifsg/documents/${viewing.id}/file`" @update:open="viewing = null"
      />
      <form class="flex flex-wrap items-end gap-2" @submit.prevent="upload">
        <UFormField :label="l.documentTitle"><UInput v-model="documentTitle" maxlength="200" class="w-64" /></UFormField>
        <input
          ref="fileInput" type="file" accept="application/pdf,image/jpeg,image/png" :aria-label="l.upload"
          class="block text-sm file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm hover:file:bg-gray-200"
        >
        <UButton type="submit" color="neutral" variant="outline" icon="i-lucide-upload" :label="l.upload" :disabled="busy" />
      </form>
    </div>

    <div class="flex flex-wrap gap-2">
      <UButton color="neutral" variant="outline" icon="i-lucide-copy" :label="l.takeRki" :disabled="busy" @click="applyPreset('rki')" />
      <UButton color="neutral" variant="outline" icon="i-lucide-file-check" :label="l.takeRnk" :disabled="busy" @click="applyPreset('rnk_2024')" />
      <UButton class="ml-auto" icon="i-lucide-plus" :label="l.add" :disabled="busy" @click="openEdit(null)" />
    </div>

    <ul class="divide-y divide-gray-100 rounded-md ring-1 ring-gray-200">
      <li v-for="row in data.rows" :key="row.key" class="space-y-1 px-3 py-2 text-sm">
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-medium">{{ row.merged.name }}</span>
          <span v-if="row.rki === null" class="rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-800">{{ l.local }}</span>
          <span v-if="!row.merged.binding" class="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">{{ l.notBinding }}</span>
          <span v-if="row.difference" class="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">{{ l.differs }}</span>
          <span class="ml-auto flex gap-1">
            <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-pencil" :label="l.edit" :disabled="busy" @click="openEdit(row)" />
            <UButton
              v-if="row.local && !(row.rki === null && row.used)" size="sm" color="neutral" variant="ghost"
              :icon="row.rki === null ? 'i-lucide-trash-2' : 'i-lucide-rotate-ccw'" :label="row.rki === null ? l.remove : l.reset" :disabled="busy" @click="reset(row)"
            />
            <span v-else-if="row.rki === null && row.used" class="text-xs text-gray-500">{{ l.inUse }}</span>
          </span>
        </div>
        <p v-if="row.difference" class="text-xs text-amber-900">{{ ifsgDifferenceTexts(row.difference).join(' · ') }}</p>
        <div class="grid gap-2 text-xs text-gray-700 md:grid-cols-2">
          <p v-if="row.rki">
            <span class="font-semibold">{{ l.rki }}:</span> {{ ifsgRulesText(row.rki.kinds.sick?.rules ?? []) }} · {{ de.ifsg.proofs[row.rki.kinds.sick?.proof ?? 'medical_certificate'] }}
          </p>
          <p v-if="row.local">
            <span class="font-semibold">{{ officeName ? de.ifsg.sourceLocal(officeName) : l.ownRule }}:</span>
            {{ ifsgRulesText(row.merged.kinds.sick?.rules ?? []) }} · {{ de.ifsg.proofs[row.merged.kinds.sick?.proof ?? 'none'] }}
          </p>
        </div>
      </li>
    </ul>

    <UModal v-model:open="editOpen" :title="editing?.row?.merged.name ?? l.add">
      <template #body>
        <form v-if="editing" class="space-y-3" @submit.prevent="save">
          <template v-if="editing.custom">
            <UFormField :label="f.name" required><UInput v-model="form.name" maxlength="200" class="w-full" /></UFormField>
            <UCheckbox v-model="form.notifiable" :label="f.notifiable" />
            <p v-if="!form.notifiable" class="text-xs text-amber-900">{{ l.notBinding }}</p>
          </template>
          <UFormField :label="f.text" :help="editing.row?.rki ? f.rkiValue(editing.row.rki.kinds.sick?.text ?? '') : undefined">
            <UTextarea v-model="form.text" :rows="3" autoresize maxlength="2000" class="w-full" />
          </UFormField>
          <UFormField :label="f.rules" :help="editing.row?.rki ? f.rkiValue(ifsgRulesText(editing.row.rki.kinds.sick?.rules ?? [])) : undefined">
            <div class="space-y-2">
              <div v-for="(rule, index) in form.rules" :key="index" class="flex flex-wrap items-end gap-2">
                <USelect v-model="rule.anchor" :items="anchorItems" class="w-56" :aria-label="f.anchor" />
                <UInput v-model.number="rule.days" type="number" min="0" max="365" class="w-20" :aria-label="f.days" />
                <UInput v-model="rule.label" maxlength="100" class="w-56" :placeholder="f.label" :aria-label="f.label" />
                <UInput v-model="rule.condition" maxlength="200" class="w-56" :placeholder="f.condition" :aria-label="f.condition" />
                <UButton type="button" size="sm" color="neutral" variant="ghost" icon="i-lucide-x" :aria-label="de.common.delete" @click="form.rules.splice(index, 1)" />
              </div>
              <div class="flex flex-wrap gap-2">
                <UButton v-if="form.rules.length < 3" type="button" size="sm" color="neutral" variant="outline" icon="i-lucide-plus" :label="f.addRule" @click="addRule" />
                <UButton
                  v-if="form.ownRules && !editing.custom" type="button" size="sm" color="neutral" variant="ghost" :label="f.likeRki"
                  @click="form.ownRules = false; form.rules = []"
                />
              </div>
            </div>
          </UFormField>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField :label="f.proof"><USelect v-model="form.proof" :items="proofItems" class="w-full" /></UFormField>
            <p v-if="!editing.custom" class="text-xs text-gray-600 sm:col-span-2">{{ f.notifyByLaw }}</p>
            <UFormField :label="f.household"><USelect v-model="form.householdExclusion" :items="triItems" class="w-full" /></UFormField>
          </div>
          <UFormField :label="f.householdText"><UTextarea v-model="form.householdText" :rows="2" autoresize maxlength="2000" class="w-full" /></UFormField>
          <UFormField :label="f.note"><UInput v-model="form.note" maxlength="2000" class="w-full" /></UFormField>
          <UFormField :label="f.hint"><UInput v-model="form.hint" maxlength="1000" class="w-full" /></UFormField>
          <div class="flex gap-2">
            <UButton type="submit" :label="de.common.save" :loading="busy" :disabled="busy || (editing.custom && !form.name.trim())" />
            <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" @click="editing = null" />
          </div>
        </form>
      </template>
    </UModal>
  </section>
</template>
