<script setup lang="ts">
import type { ChildDocumentTargetDto, EmployeeListItemDto, PrintTemplateDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { fillKinds, searchTargets, type FillKind, type FillTarget } from '~/utils/pdfFill'
import { templateFileUrl } from '~/utils/printTemplates'

/**
 * Starts filling a form: picks what is missing — the template (from the facility's fillable templates the viewer sees,
 * e.g. „Aus Vorlage ausfüllen“ in a record) and/or for whom („für ein Kind“ / „für eine Person aus dem Team“, only
 * the kinds and the children or persons the viewer may add documents to, searchable) — and then opens the fill view.
 */
const props = defineProps<{
  template?: { id: number; title: string }
  target?: FillTarget
  /** The templates the parent has loaded already (else fetched here). */
  templates?: PrintTemplateDto[]
}>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ saved: [] }>()
const t = de.pdfFill

const { can } = useCan()
const { rights, onTablet } = useChildRights()
const kinds = computed(() => fillKinds({ onTablet: onTablet.value, tabletMayEdit: rights.value?.canEdit ?? false, can }))

const chosenTemplate = ref<{ id: number; title: string } | null>(null)
const chosenTarget = ref<FillTarget | null>(null)
const kind = ref<FillKind | null>(null)
const query = ref('')
const filling = ref(false)

interface Entry { id: number; name: string; note: string | null }
const loadedTemplates = ref<PrintTemplateDto[] | null>(null)
const templates = computed(() => props.templates ?? loadedTemplates.value)
const people = ref<Entry[] | null>(null)
const loadError = ref<string | null>(null)

const template = computed(() => props.template ?? chosenTemplate.value)
const target = computed(() => props.target ?? chosenTarget.value)
const step = computed<'template' | 'target' | null>(() => (!template.value ? 'template' : !target.value ? 'target' : null))

const templateEntries = computed<Entry[]>(() => (templates.value ?? []).filter(entry => entry.fillable)
  .map(entry => ({ id: entry.id, name: entry.title, note: entry.category || null })))
const shown = computed(() => searchTargets(step.value === 'template' ? templateEntries.value : people.value ?? [], query.value))
const loading = computed(() => (step.value === 'template' ? templates.value === null : people.value === null) && !loadError.value)

async function loadTemplates() {
  try {
    loadedTemplates.value = await $fetch<PrintTemplateDto[]>('/api/print-templates')
  }
  catch (error) {
    loadError.value = errorMessage(error)
  }
}

async function loadPeople(next: FillKind) {
  people.value = null
  loadError.value = null
  try {
    if (next === 'child') {
      const list = await $fetch<ChildDocumentTargetDto[]>('/api/children/document-targets')
      people.value = list.map(child => ({
        id: child.id, name: `${child.firstName} ${child.lastName}`, note: [child.groupName, child.planned ? t.planned : null].filter(Boolean).join(' · ') || null,
      }))
    }
    else {
      const list = await $fetch<EmployeeListItemDto[]>('/api/employees')
      people.value = [...list].sort((a, b) => Number(a.leftOn !== null) - Number(b.leftOn !== null) || a.name.localeCompare(b.name, 'de'))
        .map(person => ({ id: person.id, name: person.name, note: person.leftOn ? t.left : null }))
    }
  }
  catch (error) {
    loadError.value = errorMessage(error)
  }
}

function chooseKind(next: FillKind) {
  if (kind.value === next) return
  kind.value = next
  query.value = ''
  void loadPeople(next)
}

function pick(entry: Entry) {
  query.value = ''
  if (step.value === 'template') {
    chosenTemplate.value = { id: entry.id, title: entry.name }
    prepareTarget()
  }
  else if (kind.value) {
    chosenTarget.value = { kind: kind.value, id: entry.id, name: entry.name }
  }
  if (template.value && target.value) startFilling()
}

function prepareTarget() {
  if (target.value) return
  const only = kinds.value.length === 1 ? kinds.value[0]! : null
  kind.value = null
  people.value = null
  if (only) chooseKind(only)
}

function startFilling() {
  open.value = false
  filling.value = true
}

watch(open, (isOpen) => {
  if (!isOpen) return
  chosenTemplate.value = null
  chosenTarget.value = null
  query.value = ''
  loadError.value = null
  if (!props.template) {
    if (!props.templates) {
      loadedTemplates.value = null
      void loadTemplates()
    }
  }
  else {
    prepareTarget()
    // Nothing to pick: straight to the form.
    if (target.value) startFilling()
  }
}, { immediate: true })

const title = computed(() => (template.value ? t.startTitle(template.value.title) : t.fromTemplate))
const source = computed(() => (template.value ? { url: templateFileUrl(template.value.id), title: template.value.title } : null))
</script>

<template>
  <UModal v-model:open="open" :title="title">
    <template #body>
      <div class="space-y-3">
        <template v-if="step === 'target'">
          <div v-if="kinds.length > 1" class="space-y-1.5">
            <p class="text-sm font-medium">{{ t.forWhom }}</p>
            <div class="grid gap-2 sm:grid-cols-2">
              <button
                v-for="entry in kinds" :key="entry" type="button" :aria-pressed="kind === entry"
                class="min-h-11 rounded-lg px-3 text-sm ring-1 focus-visible:outline-2 focus-visible:outline-primary"
                :class="kind === entry ? 'bg-sky-50 font-semibold text-sky-800 ring-sky-400' : 'bg-white text-gray-700 ring-gray-200 hover:bg-gray-50'"
                @click="chooseKind(entry)"
              >
                {{ t.kinds[entry] }}
              </button>
            </div>
          </div>
        </template>

        <template v-if="step === 'template' || kind">
          <UInput
            v-model="query" icon="i-lucide-search" class="w-full" autofocus
            :placeholder="step === 'template' ? t.search.template : t.search[kind!]" :aria-label="step === 'template' ? t.search.template : t.search[kind!]"
          />
          <UAlert v-if="loadError" color="error" variant="soft" :title="loadError" />
          <p v-else-if="loading" class="text-sm text-gray-500">{{ t.loading }}</p>
          <p v-else-if="step === 'template' && !templateEntries.length" class="text-sm text-gray-600">{{ t.noTemplates }}</p>
          <p v-else-if="step === 'target' && !people?.length" class="text-sm text-gray-600">{{ t.noTargets[kind!] }}</p>
          <p v-else-if="!shown.length" class="text-sm text-gray-500">{{ t.noMatch }}</p>
          <ul v-else class="max-h-80 divide-y divide-gray-100 overflow-y-auto rounded-lg ring-1 ring-gray-200">
            <li v-for="entry in shown" :key="entry.id">
              <button type="button" class="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 focus-visible:bg-sky-50 focus-visible:outline-none" @click="pick(entry)">
                <span class="min-w-0 flex-1 truncate font-medium">{{ entry.name }}</span>
                <span v-if="entry.note" class="shrink-0 text-xs text-gray-500">{{ entry.note }}</span>
              </button>
            </li>
          </ul>
        </template>
      </div>
    </template>
  </UModal>

  <PdfFillDialog v-if="filling && source && target" v-model:open="filling" :source="source" :target="target" @saved="emit('saved')" />
</template>
