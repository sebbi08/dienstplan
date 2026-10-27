<script setup lang="ts">
import {
  FORM_KINDS, FORM_LIMITS, ITEM_KINDS, addItem, addSection, moveItem, moveSection, removeItem, removeSection,
  type FormContent, type FormItem, type FormKind, type ItemDraft, type ItemKind,
} from '#shared/domain/forms'
import type { FormTemplateDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorCode, errorMessage } from '~/utils/errors'
import { formatDateTime } from '~/utils/format'

/**
 * Settings → Bögen: the form templates of the active facility per kind (create, copy, rename, archive, delete) and the
 * editor of one template (sections and items with arrows, inline texts, the options of a choices item). The editor works
 * on a local copy and sends the whole content with „Vorlage speichern“; the server checks it and answers in German.
 * An item's kind cannot change (delete it and add a new one).
 */
// All kinds at once, one block per kind (Mitarbeitergespräche, Kinder, Teamsitzungen), so none is hidden.
const { data: templates, refresh } = await useFetch<FormTemplateDto[]>('/api/form-templates', { default: () => [] })
const run = useAction(refresh)
const confirm = useConfirm()
const toast = useToast()

const itemKindItems = ITEM_KINDS.map(value => ({ label: de.forms.itemKinds[value], value }))
const activeOf = (kind: FormKind) => (templates.value ?? []).filter(template => template.kind === kind && !template.archived)
const archivedOf = (kind: FormKind) => (templates.value ?? []).filter(template => template.kind === kind && template.archived)

// ---- list ---------------------------------------------------------------
const newName = reactive<Record<FormKind, string>>({ staff: '', child: '', team: '' })
const newSelf = ref(false)
async function create(kind: FormKind) {
  try {
    const { id } = await $fetch<{ id: number }>('/api/form-templates', {
      method: 'POST', body: { kind, name: newName[kind], selfAssessment: kind === 'staff' && newSelf.value },
    })
    newName[kind] = ''
    newSelf.value = false
    await refresh()
    toast.add({ title: de.forms.created, color: 'success' })
    openEditor(id)
  }
  catch (error) {
    toast.add({ title: errorMessage(error), color: 'error' })
  }
}
const copy = (template: FormTemplateDto) =>
  run(() => $fetch<unknown>(`/api/form-templates/${template.id}/copy`, { method: 'POST' }), de.forms.copied)
const setArchived = (template: FormTemplateDto, value: boolean) =>
  run(() => $fetch<unknown>(`/api/form-templates/${template.id}`, { method: 'PUT', body: { archived: value } }),
    value ? de.forms.archivedDone : de.forms.unarchivedDone)
async function remove(template: FormTemplateDto) {
  if (await confirm(de.forms.deleteTemplateConfirm(template.name))) {
    await run(() => $fetch<unknown>(`/api/form-templates/${template.id}`, { method: 'DELETE' }), de.common.deleted)
  }
}

// ---- editor -------------------------------------------------------------
interface Draft { name: string; selfAssessment: boolean; content: FormContent }
const editingId = ref<number | null>(null)
const editing = computed(() => (templates.value ?? []).find(template => template.id === editingId.value) ?? null)
/** The kind of the template being edited (only a Mitarbeitergespräch has „vom Mitarbeiter auszufüllen“). */
const kind = computed<FormKind>(() => editing.value?.kind ?? 'staff')
const draft = ref<Draft | null>(null)
const baseline = ref('')
const saving = ref(false)
const snapshot = (value: Draft) => JSON.stringify(value)
const dirty = useDirty(() => draft.value !== null && snapshot(draft.value) !== baseline.value)

/** Ids for new sections, items and options (the server keeps them); without a secure context a random fallback. */
const newId = () => globalThis.crypto?.randomUUID?.() ?? `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

/** The template's last change the draft is based on: a save sends it, a newer save of someone else is refused. */
const loadedAt = ref('')
const conflict = ref(false)
function loadDraft(template: FormTemplateDto) {
  draft.value = { name: template.name, selfAssessment: template.selfAssessment, content: JSON.parse(JSON.stringify(template.content)) }
  baseline.value = snapshot(draft.value)
  loadedAt.value = template.updatedAt
  conflict.value = false
}
/** „Neu laden“ after a conflict: the stored template replaces the draft (asked first, the own edits go). */
async function reloadDraft() {
  if (dirty.value && !await confirm(de.forms.reloadConfirm, { confirmLabel: de.forms.reload })) return
  await refresh()
  if (editing.value) loadDraft(editing.value)
}
function openEditor(id: number) {
  const template = (templates.value ?? []).find(entry => entry.id === id)
  if (!template) return
  editingId.value = id
  loadDraft(template)
}
async function closeEditor() {
  if (dirty.value && !await confirm(de.settingsAreas.unsavedConfirm, { confirmLabel: de.settingsAreas.unsavedLeave })) return
  editingId.value = null
  draft.value = null
}
async function discard() {
  if (editing.value) loadDraft(editing.value)
}

/** Runs an edit helper on the draft's content; its German error (e.g. a full section) shows as a toast. */
function edit(change: (content: FormContent) => FormContent) {
  if (!draft.value) return
  try {
    draft.value.content = change(draft.value.content)
  }
  catch (error) {
    const code = (error as { code?: string }).code
    toast.add({ title: code && code in de.errors ? de.errors[code as keyof typeof de.errors] : de.errors.generic, color: 'error' })
  }
}
const newKind = reactive<Record<string, ItemKind>>({})
function emptyItem(itemKind: ItemKind): ItemDraft {
  switch (itemKind) {
    case 'note': return { kind: 'note', text: '' }
    case 'text': return { kind: 'text', question: '' }
    case 'choices': return { kind: 'choices', question: '', options: [{ id: newId(), label: '' }] }
    case 'rating': return { kind: 'rating', criterion: '' }
    case 'milestone': return { kind: 'milestone', text: '', ageLabel: '' }
    case 'date': return { kind: 'date', question: '' }
  }
}
const addNewSection = () => edit(content => addSection(content, { title: de.forms.newSection, hint: '' }, newId))
const addNewItem = (sectionId: string) => edit(content => addItem(content, sectionId, emptyItem(newKind[sectionId] ?? 'text'), newId))
async function deleteSection(sectionId: string, title: string) {
  if (await confirm(de.forms.deleteSectionConfirm(title))) edit(content => removeSection(content, sectionId))
}
async function deleteItem(itemId: string) {
  if (await confirm(de.forms.deleteItemConfirm)) edit(content => removeItem(content, itemId))
}
const firstItemId = computed(() => draft.value?.content.sections.find(section => section.items.length)?.items[0]?.id)
const lastItemId = computed(() => draft.value?.content.sections.findLast(section => section.items.length)?.items.at(-1)?.id)

function addOption(item: FormItem) {
  if (item.kind === 'choices' && item.options.length < FORM_LIMITS.options) item.options.push({ id: newId(), label: '' })
}
function removeOptionAt(item: FormItem, index: number) {
  if (item.kind === 'choices' && item.options.length > 1) item.options.splice(index, 1)
}

async function save() {
  if (!draft.value || !editing.value) return
  saving.value = true
  const sent = snapshot(draft.value)
  try {
    const body = JSON.parse(sent) as Draft
    await $fetch<unknown>(`/api/form-templates/${editing.value.id}`, {
      method: 'PUT',
      body: {
        name: body.name, selfAssessment: kind.value === 'staff' && body.selfAssessment, content: body.content,
        expectedUpdatedAt: loadedAt.value,
      },
    })
    await refresh()
    // The server trims texts: take its copy, keep edits typed while saving (the next save builds on this one).
    if (editing.value && draft.value && snapshot(draft.value) === sent) loadDraft(editing.value)
    else if (editing.value) loadedAt.value = editing.value.updatedAt
    toast.add({ title: de.common.saved, color: 'success' })
  }
  catch (error) {
    // A conflict also stays above the editor with „Neu laden“.
    if (errorCode(error) === 'form_template_changed') conflict.value = true
    toast.add({ title: errorMessage(error), color: 'error' })
  }
  finally {
    saving.value = false
  }
}

const iconButton = { size: 'xs', color: 'neutral', variant: 'ghost' } as const
</script>

<template>
  <section class="min-w-0 space-y-3 rounded-lg bg-white p-3 ring-1 ring-gray-200 sm:p-4">
    <h2 class="font-semibold">{{ de.forms.templatesTitle }}</h2>

    <!-- The lists, one block per kind -->
    <template v-if="!draft">
      <p class="text-xs text-gray-500">{{ de.forms.templatesHint }}</p>
      <div v-for="listKind in FORM_KINDS" :key="listKind" class="space-y-2 border-t border-gray-100 pt-3">
        <h3 class="font-medium">{{ de.forms.kindGroups[listKind] }}</h3>
        <p v-if="!activeOf(listKind).length && !archivedOf(listKind).length" class="text-sm text-gray-500">{{ de.forms.noTemplates }}</p>
        <ul class="divide-y divide-gray-100">
          <li v-for="template in activeOf(listKind)" :key="template.id" class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <div class="min-w-0 flex-1 basis-48">
              <div class="font-medium break-words">{{ template.name }}</div>
              <div class="flex flex-wrap gap-1">
                <UBadge v-if="template.starterKey" color="neutral" variant="soft" size="sm" :label="de.forms.starter" />
                <UBadge v-if="template.selfAssessment" color="info" variant="soft" size="sm" :label="de.forms.selfAssessmentBadge" />
              </div>
            </div>
            <div class="flex flex-wrap gap-1">
              <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-pencil" :label="de.forms.edit" @click="openEditor(template.id)" />
              <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-copy" :label="de.forms.copy" @click="copy(template)" />
              <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-archive" :label="de.forms.archive" @click="setArchived(template, true)" />
              <UButton
                size="sm" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete"
                :disabled="template.inUse" :title="template.inUse ? de.forms.inUseHint : de.common.delete" @click="remove(template)"
              />
            </div>
          </li>
        </ul>
        <form class="flex flex-wrap items-center gap-2" @submit.prevent="create(listKind)">
          <UInput
            v-model="newName[listKind]" required :maxlength="FORM_LIMITS.templateName" size="sm" class="w-full sm:w-72"
            :placeholder="de.forms.newTemplateName" :aria-label="`${de.forms.newTemplateName} (${de.forms.kindGroups[listKind]})`"
          />
          <UCheckbox v-if="listKind === 'staff'" v-model="newSelf" :label="de.forms.selfAssessment" />
          <UButton type="submit" size="sm" icon="i-lucide-plus" :label="de.forms.createTemplate" :disabled="!newName[listKind].trim()" />
        </form>

        <details v-if="archivedOf(listKind).length" class="pt-1">
          <summary class="cursor-pointer text-sm font-medium text-gray-700">{{ de.forms.archivedList(archivedOf(listKind).length) }}</summary>
          <ul class="mt-1 divide-y divide-gray-100">
            <li v-for="template in archivedOf(listKind)" :key="template.id" class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <div class="min-w-0 flex-1 basis-48 break-words text-gray-600">{{ template.name }}</div>
              <div class="flex flex-wrap gap-1">
                <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-archive-restore" :label="de.forms.unarchive" @click="setArchived(template, false)" />
                <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-copy" :label="de.forms.copy" @click="copy(template)" />
                <UButton
                  size="sm" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete"
                  :disabled="template.inUse" :title="template.inUse ? de.forms.inUseHint : de.common.delete" @click="remove(template)"
                />
              </div>
            </li>
          </ul>
        </details>
      </div>
      <p v-if="(templates ?? []).some(template => template.inUse)" class="text-xs text-gray-500">{{ de.forms.inUseHint }}</p>
    </template>

    <!-- The editor of one template -->
    <form v-else class="space-y-3" @submit.prevent="save">
      <div class="flex flex-wrap items-center gap-2">
        <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-arrow-left" :label="de.forms.back" @click="closeEditor" />
        <span class="text-sm text-gray-500">{{ de.forms.kinds[kind] }}</span>
      </div>
      <div class="flex flex-wrap items-end gap-3">
        <UFormField :label="de.forms.name" class="w-full sm:w-96">
          <UInput v-model="draft.name" required :maxlength="FORM_LIMITS.templateName" class="w-full" />
        </UFormField>
        <UCheckbox v-if="kind === 'staff'" v-model="draft.selfAssessment" :label="de.forms.selfAssessment" :description="de.forms.selfAssessmentHint" />
      </div>
      <UAlert v-if="conflict" color="warning" variant="soft" :title="de.errors.form_template_changed" :description="de.forms.reloadHint">
        <template #actions>
          <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-refresh-cw" :label="de.forms.reload" @click="reloadDraft" />
        </template>
      </UAlert>
      <p class="text-xs text-gray-500">{{ de.forms.kindFixedHint }}</p>
      <p v-if="!draft.content.sections.length" class="text-sm text-gray-500">{{ de.forms.noSections }}</p>

      <div
        v-for="(section, sectionIndex) in draft.content.sections" :key="section.id"
        class="min-w-0 space-y-2 rounded-md bg-gray-50 p-2 ring-1 ring-gray-200 sm:p-3"
      >
        <div class="flex items-start gap-1">
          <UInput
            v-model="section.title" required :maxlength="FORM_LIMITS.sectionTitle" class="min-w-0 flex-1 font-semibold"
            :aria-label="de.forms.sectionTitle"
          />
          <UButton
            v-bind="iconButton" icon="i-lucide-arrow-up" :aria-label="de.forms.sectionUp" :disabled="sectionIndex === 0"
            @click="edit(content => moveSection(content, section.id, 'up'))"
          />
          <UButton
            v-bind="iconButton" icon="i-lucide-arrow-down" :aria-label="de.forms.sectionDown"
            :disabled="sectionIndex === draft.content.sections.length - 1" @click="edit(content => moveSection(content, section.id, 'down'))"
          />
          <UButton v-bind="iconButton" color="error" icon="i-lucide-trash-2" :aria-label="de.forms.deleteSection" @click="deleteSection(section.id, section.title)" />
        </div>
        <UTextarea
          v-model="section.hint" autoresize :rows="1" :maxlength="FORM_LIMITS.sectionHint" class="w-full"
          :placeholder="de.forms.sectionHint" :aria-label="de.forms.sectionHint"
        />
        <p v-if="!section.items.length" class="text-xs text-gray-500">{{ de.forms.noItems }}</p>
        <ul class="space-y-2">
          <li v-for="item in section.items" :key="item.id" class="min-w-0 space-y-1.5 rounded-md bg-white p-2 ring-1 ring-gray-200">
            <div class="flex items-center gap-1">
              <UBadge color="neutral" variant="soft" size="sm" :label="de.forms.itemKinds[item.kind]" />
              <span class="flex-1" />
              <UButton
                v-bind="iconButton" icon="i-lucide-arrow-up" :aria-label="de.forms.itemUp" :disabled="item.id === firstItemId"
                @click="edit(content => moveItem(content, item.id, 'up'))"
              />
              <UButton
                v-bind="iconButton" icon="i-lucide-arrow-down" :aria-label="de.forms.itemDown" :disabled="item.id === lastItemId"
                @click="edit(content => moveItem(content, item.id, 'down'))"
              />
              <UButton v-bind="iconButton" color="error" icon="i-lucide-trash-2" :aria-label="de.forms.deleteItem" @click="deleteItem(item.id)" />
            </div>
            <UTextarea
              v-if="item.kind === 'note'" v-model="item.text" required autoresize :rows="2" :maxlength="FORM_LIMITS.note"
              class="w-full" :aria-label="de.forms.itemText.note" :placeholder="de.forms.itemText.note"
            />
            <UTextarea
              v-else-if="item.kind === 'text' || item.kind === 'date'" v-model="item.question" required autoresize :rows="1" :maxlength="FORM_LIMITS.question"
              class="w-full" :aria-label="de.forms.itemText[item.kind]" :placeholder="de.forms.itemText[item.kind]"
            />
            <UTextarea
              v-else-if="item.kind === 'rating'" v-model="item.criterion" required autoresize :rows="1" :maxlength="FORM_LIMITS.question"
              class="w-full" :aria-label="de.forms.itemText.rating" :placeholder="de.forms.itemText.rating"
            />
            <div v-else-if="item.kind === 'milestone'" class="flex flex-wrap gap-2">
              <UInput
                v-model="item.ageLabel" required :maxlength="FORM_LIMITS.ageLabel" class="w-32"
                :aria-label="de.forms.ageLabel" :placeholder="de.forms.ageLabelPlaceholder"
              />
              <UTextarea
                v-model="item.text" required autoresize :rows="1" :maxlength="FORM_LIMITS.question" class="min-w-0 flex-1 basis-48"
                :aria-label="de.forms.itemText.milestone" :placeholder="de.forms.itemText.milestone"
              />
            </div>
            <div v-else-if="item.kind === 'choices'" class="space-y-1.5">
              <UTextarea
                v-model="item.question" autoresize :rows="1" :maxlength="FORM_LIMITS.question" class="w-full"
                :aria-label="de.forms.itemText.choices" :placeholder="de.forms.itemText.choices"
              />
              <p class="text-xs text-gray-500">{{ de.forms.options }}</p>
              <div v-for="(option, optionIndex) in item.options" :key="option.id" class="flex items-center gap-1 pl-2">
                <UIcon name="i-lucide-square" class="size-4 shrink-0 text-gray-400" />
                <UInput v-model="option.label" required :maxlength="FORM_LIMITS.optionLabel" size="sm" class="min-w-0 flex-1" :aria-label="de.forms.options" />
                <UButton
                  v-bind="iconButton" icon="i-lucide-x" :aria-label="de.forms.removeOption" :disabled="item.options.length <= 1"
                  @click="removeOptionAt(item, optionIndex)"
                />
              </div>
              <UButton
                size="xs" color="neutral" variant="ghost" icon="i-lucide-plus" :label="de.forms.addOption"
                :disabled="item.options.length >= FORM_LIMITS.options" @click="addOption(item)"
              />
            </div>
          </li>
        </ul>
        <div class="flex flex-wrap items-center gap-2">
          <USelect
            :model-value="newKind[section.id] ?? 'text'" :items="itemKindItems" size="sm" class="w-40" :aria-label="de.forms.addItem"
            @update:model-value="newKind[section.id] = $event as ItemKind"
          />
          <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-plus" :label="de.forms.addItem" @click="addNewItem(section.id)" />
        </div>
      </div>

      <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-plus" :label="de.forms.addSection" @click="addNewSection" />

      <p v-if="editing" class="text-xs text-gray-500">{{ de.forms.lastChanged(editing.updatedBy, formatDateTime(editing.updatedAt)) }}</p>
      <div class="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t border-gray-200 bg-white/95 py-2">
        <UButton type="submit" icon="i-lucide-save" :label="de.forms.saveTemplate" :loading="saving" :disabled="!dirty" />
        <UButton v-if="dirty" color="neutral" variant="ghost" :label="de.forms.discard" @click="discard" />
        <span v-if="dirty" class="text-sm text-amber-700">{{ de.forms.unsaved }}</span>
      </div>
    </form>
  </section>
</template>
