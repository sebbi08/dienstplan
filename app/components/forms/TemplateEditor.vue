<script setup lang="ts">
import {
  FORM_LIMITS, ITEM_KINDS, TABLE_COLUMN_TYPES, addItem, addSection, moveItem, moveSection, removeItem, removeSection,
  type FormContent, type FormItem, type FormKind, type ItemDraft, type ItemKind, type TableColumnType, type TableItem,
  type TableRowLabel,
} from '#shared/domain/forms'
import type { FormTemplateDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorCode, errorMessage, errorTextOf } from '~/utils/errors'
import { formatDateTime } from '~/utils/format'
import { switchedRowMode } from '~/utils/forms'

/**
 * „Dokumente“ → „Vorlagen“, the editor of one Bogen (form template), opened from the list (templates/Library.vue):
 * sections and items with arrows, inline texts, the options of a choices item. It works on a local copy and sends the
 * whole content with „Vorlage speichern“; the server checks it and answers in German. An item's kind cannot change
 * (delete it and add a new one). „Zurück zur Liste“ asks first while there are unsaved changes, then emits `close`.
 * `templates` is the list as loaded (refreshed with `refresh`), so a save shows the server's copy.
 */
const props = defineProps<{ templates: FormTemplateDto[]; templateId: number; refresh: () => Promise<unknown> }>()
const emit = defineEmits<{ close: [] }>()
const refresh = () => props.refresh()
const confirm = useConfirm()
const toast = useToast()

// ---- editor -------------------------------------------------------------
interface Draft { name: string; selfAssessment: boolean; content: FormContent }
const editing = computed(() => props.templates.find(template => template.id === props.templateId) ?? null)
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
if (editing.value) loadDraft(editing.value)
async function closeEditor() {
  if (dirty.value && !await confirm(de.settingsAreas.unsavedConfirm, { confirmLabel: de.settingsAreas.unsavedLeave })) return
  draft.value = null
  emit('close')
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
    toast.add({ title: errorTextOf(code), color: 'error' })
  }
}
const itemKindItems = ITEM_KINDS.map(value => ({ label: de.forms.itemKinds[value], value }))
const newKind = reactive<Record<string, ItemKind>>({})
function emptyItem(itemKind: ItemKind): ItemDraft {
  switch (itemKind) {
    case 'note': return { kind: 'note', text: '' }
    case 'text': return { kind: 'text', question: '' }
    case 'choices': return { kind: 'choices', question: '', options: [{ id: newId(), label: '' }] }
    case 'rating': return { kind: 'rating', criterion: '' }
    case 'milestone': return { kind: 'milestone', text: '', ageLabel: '' }
    case 'date': return { kind: 'date', question: '' }
    case 'table': return {
      kind: 'table', question: '', columns: [{ id: newId(), heading: '', type: 'text' }], rows: [{ id: newId(), label: '' }], freeRows: false,
    }
    case 'checkbox': return { kind: 'checkbox', label: '' }
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
/**
 * „mehrere Antworten“ / „nur eine Antwort“ of an Ankreuzliste. Switching is always allowed: every Bogen made already
 * keeps its own copy of the list with its answers, so only new Bögen take the change.
 */
const choiceModeItems = [
  { label: de.forms.choiceModes.multiple, value: 'multiple' }, { label: de.forms.choiceModes.single, value: 'single' },
]
function setChoiceMode(item: FormItem, mode: string) {
  if (item.kind !== 'choices') return
  if (mode === 'single') item.single = true
  else delete item.single
}

// ---- tables ---------------------------------------------------------------
const columnTypeItems = TABLE_COLUMN_TYPES.map(value => ({ label: de.forms.table.columnTypes[value], value }))
const rowModeItems = [
  { label: de.forms.table.rowModes.fixed, value: 'fixed' }, { label: de.forms.table.rowModes.free, value: 'free' },
]
/** The fixed rows of a table switched to free rows, per item: back when switched back (until the editor closes). */
const stashedRows: Record<string, TableRowLabel[]> = {}
function setRowMode(item: TableItem, mode: string) {
  const freeRows = mode === 'free'
  if (freeRows === item.freeRows) return
  const next = switchedRowMode(item.rows, freeRows, stashedRows[item.id] ?? [], newId)
  stashedRows[item.id] = next.stash
  item.rows = next.rows
  item.freeRows = freeRows
}
function addColumn(item: TableItem) {
  if (item.columns.length < FORM_LIMITS.tableColumns) item.columns.push({ id: newId(), heading: '', type: 'text' })
}
function removeColumnAt(item: TableItem, index: number) {
  if (item.columns.length > 1) item.columns.splice(index, 1)
}
function addTableRow(item: TableItem) {
  if (item.rows.length < FORM_LIMITS.tableRows) item.rows.push({ id: newId(), label: '' })
}
function removeTableRowAt(item: TableItem, index: number) {
  if (item.rows.length > 1) item.rows.splice(index, 1)
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
  <div class="min-w-0 space-y-3">
    <!-- The editor of one template -->
    <form v-if="draft" class="space-y-3 rounded-lg bg-white p-3 ring-1 ring-gray-200 sm:p-4" @submit.prevent="save">
      <div class="flex flex-wrap items-center gap-2">
        <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-arrow-left" :label="de.forms.back" @click="closeEditor" />
        <span class="text-sm text-gray-500">{{ de.forms.kinds[kind] }}<template v-if="editing?.subject"> · {{ de.forms.subjectBadge(de.forms.subjects[editing.subject]) }}</template></span>
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
              <!-- Filled from the app's data when a form is made (the key stays with the item). -->
              <UBadge v-if="'prefill' in item && item.prefill" color="info" variant="soft" size="sm" :label="de.forms.prefillBadge" :title="de.forms.prefillHint" />
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
              <div class="flex flex-wrap items-center gap-2">
                <p class="text-xs text-gray-500">{{ de.forms.options }}</p>
                <span class="flex-1" />
                <USelect
                  :model-value="item.single ? 'single' : 'multiple'" :items="choiceModeItems" size="xs" class="w-44"
                  :aria-label="de.forms.choiceMode" @update:model-value="setChoiceMode(item, String($event))"
                />
              </div>
              <div v-for="(option, optionIndex) in item.options" :key="option.id" class="flex items-center gap-1 pl-2">
                <UIcon :name="item.single ? 'i-lucide-circle' : 'i-lucide-square'" class="size-4 shrink-0 text-gray-400" />
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
            <UInput
              v-else-if="item.kind === 'checkbox'" v-model="item.label" required :maxlength="FORM_LIMITS.checkboxLabel" class="w-full"
              :aria-label="de.forms.itemText.checkbox" :placeholder="de.forms.itemText.checkbox"
            />
            <div v-else-if="item.kind === 'table'" class="space-y-2">
              <UTextarea
                v-model="item.question" autoresize :rows="1" :maxlength="FORM_LIMITS.tableQuestion" class="w-full"
                :aria-label="de.forms.itemText.table" :placeholder="de.forms.itemText.table"
              />
              <div class="space-y-1.5">
                <p class="text-xs text-gray-500">{{ de.forms.table.columns }}</p>
                <div v-for="(column, columnIndex) in item.columns" :key="column.id" class="flex flex-wrap items-center gap-1 pl-2">
                  <UInput
                    v-model="column.heading" required :maxlength="FORM_LIMITS.tableHeading" size="sm" class="min-w-0 flex-1 basis-40"
                    :aria-label="de.forms.table.columnHeading" :placeholder="de.forms.table.columnHeading"
                  />
                  <USelect
                    :model-value="column.type" :items="columnTypeItems" size="sm" class="w-32" :aria-label="de.forms.table.columnType"
                    @update:model-value="column.type = $event as TableColumnType"
                  />
                  <UButton
                    v-bind="iconButton" icon="i-lucide-x" :aria-label="de.forms.table.removeColumn" :disabled="item.columns.length <= 1"
                    @click="removeColumnAt(item, columnIndex)"
                  />
                </div>
                <UButton
                  size="xs" color="neutral" variant="ghost" icon="i-lucide-plus" :label="de.forms.table.addColumn"
                  :disabled="item.columns.length >= FORM_LIMITS.tableColumns" @click="addColumn(item)"
                />
              </div>
              <div class="space-y-1.5">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="text-xs text-gray-500">{{ de.forms.table.rowMode }}</p>
                  <USelect
                    :model-value="item.freeRows ? 'free' : 'fixed'" :items="rowModeItems" size="xs" class="w-72 max-w-full"
                    :aria-label="de.forms.table.rowMode" @update:model-value="setRowMode(item, String($event))"
                  />
                </div>
                <p v-if="item.freeRows" class="pl-2 text-xs text-gray-500">{{ de.forms.table.freeRowsHint(FORM_LIMITS.tableFreeRows) }}</p>
                <template v-else>
                  <div v-for="(row, rowIndex) in item.rows" :key="row.id" class="flex items-center gap-1 pl-2">
                    <UInput
                      v-model="row.label" required :maxlength="FORM_LIMITS.tableRowLabel" size="sm" class="min-w-0 flex-1"
                      :aria-label="de.forms.table.rowLabel" :placeholder="de.forms.table.rowLabel"
                    />
                    <UButton
                      v-bind="iconButton" icon="i-lucide-x" :aria-label="de.forms.table.removeFixedRow" :disabled="item.rows.length <= 1"
                      @click="removeTableRowAt(item, rowIndex)"
                    />
                  </div>
                  <UButton
                    size="xs" color="neutral" variant="ghost" icon="i-lucide-plus" :label="de.forms.table.addFixedRow"
                    :disabled="item.rows.length >= FORM_LIMITS.tableRows" @click="addTableRow(item)"
                  />
                </template>
              </div>
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
  </div>
</template>
