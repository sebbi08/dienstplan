<script setup lang="ts">
import type { AnnotationLayer, PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { todayIso } from '#shared/domain/dates'
import type { EmployeeDocumentFolder } from '#shared/domain/personnel'
import type { DocumentTypeDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { MAX_DOCUMENT_BYTES } from '~/utils/children'
import { errorMessage } from '~/utils/errors'
import { defaultDocumentType, fillSaveRequest, fillTitle, usableFolders, type FillKind, type FillSave, type FillSource, type FillTarget } from '~/utils/pdfFill'

/**
 * The fill view: a PDF form on screen with its fields editable (pdf.js, annotation layer in forms mode), one page at a
 * time with page buttons and zoom (for phones and tablets). The values live only in the document's annotationStorage;
 * „Speichern“ writes them into a copy (saveDocument) and sends it to the child's record or the personnel file —
 * as a new document (`target`: type or folder, title, date chosen in a small form) or in place of the document it was
 * opened from (`replace`, „Weiter ausfüllen“). „Drucken“ prints the filled pages without saving. The template on the
 * server never changes. Closing (or leaving the page) with unsaved input asks first. The file lives in memory only.
 */
const props = defineProps<{
  source: FillSource
  /** A new copy for this child or person. */
  target?: FillTarget
  /** The document the form was opened from („Weiter ausfüllen“). */
  replace?: { kind: FillKind; documentId: number }
}>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ saved: [] }>()

const toast = useToast()
const confirm = useConfirm()
const { can } = useCan()
const t = de.pdfFill

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
const status = ref<'loading' | 'ready' | 'noFields' | 'failed'>('loading')
const pageNumber = ref(1)
const pageCount = ref(0)
/** 1 = the page as wide as the view. */
const zoom = ref(1)
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3]
const touched = ref(false)
const busy = ref(false)
// Unsaved input keeps the page (useUnsavedGuard of the page) from being left without asking.
useDirty(() => touched.value)

const scrollEl = ref<HTMLElement | null>(null)
const pageEl = ref<HTMLElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)
const layerEl = ref<HTMLDivElement | null>(null)

let pdfjs: PdfJs | null = null
let loadingTask: PDFDocumentLoadingTask | null = null
let pdf: PDFDocumentProxy | null = null
let fieldObjects: Map<string, object[]> | null = null
let layer: AnnotationLayer | null = null
let renderTask: RenderTask | null = null
/** Counts loads and page draws; a draw that finds a newer number stops (closed, other page, other zoom). */
let generation = 0
let drawing = 0

/**
 * Links in a form open in a new tab; the form has no outline or attachments to jump to. Only what the annotation layer
 * calls (pdf.js's own link service belongs to its full viewer).
 */
const linkService = {
  eventBus: null,
  addLinkAttributes(link: HTMLAnchorElement, url: string) {
    if (!url) return
    link.href = url
    link.target = '_blank'
    link.rel = 'noopener noreferrer nofollow'
  },
  getDestinationHash: () => '#',
  getAnchorUrl: () => '#',
  goToDestination: () => {},
  executeNamedAction: () => {},
  executeSetOCGState: () => {},
  getAttachmentContent: async () => null,
} as unknown as Parameters<AnnotationLayer['render']>[0]['linkService']

function release() {
  generation++
  endPrint()
  renderTask?.cancel()
  renderTask = null
  layer?.destroy()
  layer = null
  layerEl.value?.replaceChildren()
  if (canvasEl.value) {
    canvasEl.value.width = 0
    canvasEl.value.height = 0
  }
  // Destroying the loading task also destroys its document (and the typed values with it).
  void loadingTask?.destroy()
  loadingTask = null
  pdf = null
  fieldObjects = null
  pageCount.value = 0
}

async function load() {
  release()
  const current = generation
  status.value = 'loading'
  touched.value = false
  pageNumber.value = 1
  zoom.value = 1
  try {
    const response = await $fetch.raw<ArrayBuffer>(props.source.url, { responseType: 'arrayBuffer' })
    if (current !== generation) return
    const data = response._data
    if (!data) throw new Error('empty')
    // The legacy build carries the polyfills older tablet browsers need (as the document viewer).
    const lib = await import('pdfjs-dist/legacy/build/pdf.mjs')
    if (current !== generation) return
    lib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString()
    pdfjs = lib
    const task = lib.getDocument({ data: new Uint8Array(data), enableXfa: false })
    loadingTask = task
    const doc = await task.promise
    if (current !== generation) return
    pdf = doc
    fieldObjects = await doc.getFieldObjects()
    if (current !== generation) return
    pageCount.value = doc.numPages
    status.value = fieldObjects && fieldObjects.size > 0 ? 'ready' : 'noFields'
    await nextTick()
    await draw()
  }
  catch {
    if (current === generation) {
      release()
      status.value = 'failed'
    }
  }
}

/** Draws the current page at the current zoom: the page on a canvas, the fields as inputs above it. */
async function draw() {
  const lib = pdfjs
  const doc = pdf
  const scroller = scrollEl.value
  const box = pageEl.value
  const canvas = canvasEl.value
  const layerDiv = layerEl.value
  if (!lib || !doc || !scroller || !box || !canvas || !layerDiv) return
  const current = generation
  const mine = ++drawing
  const stale = () => current !== generation || mine !== drawing
  renderTask?.cancel()
  try {
    const page = await doc.getPage(pageNumber.value)
    if (stale()) return
    const base = page.getViewport({ scale: 1 })
    const available = Math.max(240, scroller.clientWidth - 16)
    const viewport = page.getViewport({ scale: (available / base.width) * zoom.value })
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    const canvasViewport = page.getViewport({ scale: viewport.scale * ratio })
    box.style.width = `${Math.floor(viewport.width)}px`
    box.style.height = `${Math.floor(viewport.height)}px`
    box.style.setProperty('--scale-factor', String(viewport.scale))
    box.style.setProperty('--user-unit', String(viewport.userUnit))
    box.style.setProperty('--total-scale-factor', String(viewport.scale * viewport.userUnit))
    canvas.width = Math.floor(canvasViewport.width)
    canvas.height = Math.floor(canvasViewport.height)
    // Checkboxes and radio buttons draw their looks on canvases of their own, which the annotation layer then places.
    const annotationCanvasMap = new Map<string, HTMLCanvasElement>()
    const task = page.render({ canvas, viewport: canvasViewport, annotationMode: lib.AnnotationMode.ENABLE_FORMS, annotationCanvasMap })
    renderTask = task
    await task.promise
    if (stale()) return
    const annotations = await page.getAnnotations({ intent: 'display' })
    if (stale()) return
    layer?.destroy()
    layerDiv.replaceChildren()
    const layerViewport = viewport.clone({ dontFlip: true })
    layer = new lib.AnnotationLayer({
      div: layerDiv, page, viewport: layerViewport, annotationStorage: doc.annotationStorage, linkService,
      annotationCanvasMap, accessibilityManager: null, annotationEditorUIManager: null, structTreeLayer: null, commentManager: null,
    })
    await layer.render({
      viewport: layerViewport, div: layerDiv, annotations, page, linkService, annotationStorage: doc.annotationStorage,
      renderForms: true, enableScripting: false, hasJSActions: false, fieldObjects, imageResourcesPath: '',
    })
    // pdf.js sizes the layer with CSS round(), which older tablet browsers lack; the same size in pixels instead (the
    // unrotated page; a turned page is turned by the rotation rule below).
    const { pageWidth, pageHeight } = layerViewport.rawDims as { pageWidth: number; pageHeight: number }
    const total = viewport.scale * viewport.userUnit
    layerDiv.style.width = `${Math.floor(total * pageWidth)}px`
    layerDiv.style.height = `${Math.floor(total * pageHeight)}px`
  }
  catch (error) {
    if (error instanceof lib.RenderingCancelledException || stale()) return
    status.value = 'failed'
  }
}

function goTo(number: number) {
  if (number < 1 || number > pageCount.value || number === pageNumber.value) return
  // The field being typed in keeps its value: pdf.js stores every input as it comes.
  pageNumber.value = number
  scrollEl.value?.scrollTo({ top: 0, left: 0 })
  void draw()
}
function zoomBy(step: number) {
  const index = ZOOMS.indexOf(zoom.value)
  const next = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (index === -1 ? 2 : index) + step))]!
  if (next === zoom.value) return
  zoom.value = next
  void draw()
}
function zoomFit() {
  if (zoom.value === 1) return
  zoom.value = 1
  void draw()
}

// A turned phone or a resized window: the page fits the new width again.
let resizeTimer: ReturnType<typeof setTimeout> | undefined
function onResize() {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    if (status.value === 'ready' || status.value === 'noFields') void draw()
  }, 200)
}
onMounted(() => window.addEventListener('resize', onResize))

/** Any input in a field counts as unsaved (the inputs belong to pdf.js; their events bubble up to here). */
function onInput(event: Event) {
  if ((event.target as HTMLElement | null)?.closest('.annotationLayer')) touched.value = true
}

async function requestClose() {
  if (busy.value) return
  if (touched.value && !(await confirm(t.unsavedConfirm, { confirmLabel: t.unsavedLeave, danger: true }))) return
  touched.value = false
  open.value = false
}

// ---- printing ------------------------------------------------------------
/** The rendered pages while the browser prints them (removed after printing). */
let printBox: HTMLElement | null = null
/** No page margins of the browser while printing the form (the PDF has its own); only then, not for other prints. */
let printStyle: HTMLStyleElement | null = null
let printUrls: string[] = []
let printMedia: MediaQueryList | null = null
let printTimer: ReturnType<typeof setTimeout> | undefined
/** Some mobile browsers never send „afterprint“: the print view ending or, at the latest, this long ends it too. */
const PRINT_FALLBACK_MS = 10 * 60 * 1000

function onPrintMedia(event: MediaQueryListEvent) {
  if (!event.matches) endPrint()
}

/** Removes the page images (and their memory) and the print-only state; also when the fill view closes. */
function endPrint() {
  document.documentElement.classList.remove('pdf-fill-printing')
  window.removeEventListener('afterprint', endPrint)
  printMedia?.removeEventListener('change', onPrintMedia)
  printMedia = null
  clearTimeout(printTimer)
  for (const image of printBox?.querySelectorAll('img') ?? []) image.removeAttribute('src')
  printBox?.remove()
  printBox = null
  printStyle?.remove()
  printStyle = null
  for (const url of printUrls) URL.revokeObjectURL(url)
  printUrls = []
}

/** Print resolution: sharp for short forms, less memory for long documents (tablets). */
const printDpi = (pages: number) => (pages <= 10 ? 150 : pages <= 30 ? 110 : 80)

/**
 * Prints the pages with the typed values (drawn as pdf.js prints them), without saving anything. One page at a time is
 * drawn on a canvas, which is emptied right after it became a compressed image; the browser decodes the images only
 * to print them.
 */
async function print() {
  const lib = pdfjs
  const doc = pdf
  if (!lib || !doc || busy.value) return
  busy.value = true
  endPrint()
  try {
    const storage = doc.annotationStorage.print
    const box = document.createElement('div')
    box.className = 'pdf-fill-print'
    const scale = printDpi(doc.numPages) / 72
    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number)
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      await page.render({
        canvas, viewport, intent: 'print', annotationMode: lib.AnnotationMode.ENABLE_STORAGE, printAnnotationStorage: storage,
      }).promise
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
      canvas.width = 0
      canvas.height = 0
      page.cleanup()
      if (!blob) throw new Error('no image')
      const url = URL.createObjectURL(blob)
      printUrls.push(url)
      const image = document.createElement('img')
      image.alt = ''
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('image'))
        image.src = url
      })
      box.append(image)
    }
    printBox = box
    printStyle = document.createElement('style')
    printStyle.textContent = '@page { margin: 0; }'
    document.head.append(printStyle)
    document.body.append(box)
    document.documentElement.classList.add('pdf-fill-printing')
    window.addEventListener('afterprint', endPrint, { once: true })
    printMedia = window.matchMedia('print')
    printMedia.addEventListener('change', onPrintMedia)
    printTimer = setTimeout(endPrint, PRINT_FALLBACK_MS)
    window.print()
  }
  catch {
    endPrint()
    toast.add({ title: t.printFailed, color: 'error' })
  }
  finally {
    busy.value = false
  }
}

// ---- saving --------------------------------------------------------------
const sheetOpen = ref(false)
const typeList = ref<DocumentTypeDto[]>([])
const typeItems = computed(() => typeList.value.map(type => ({ label: type.name, value: type.id })))
const folders = computed(() => usableFolders(can))
const folderItems = computed(() => folders.value.map(folder => ({ label: de.personnel.folders[folder], value: folder })))
const sheet = reactive({ typeId: 0, folder: 'correspondence' as EmployeeDocumentFolder, title: '', documentDate: todayIso(), confidential: false })

async function startSave() {
  if (busy.value || !pdf) return
  if (props.replace) return void persist({ mode: 'replace', ...props.replace })
  const target = props.target
  if (!target) return
  Object.assign(sheet, { title: fillTitle(props.source.title, todayIso()), documentDate: todayIso() })
  if (target.kind === 'child') {
    try {
      typeList.value = await $fetch<DocumentTypeDto[]>('/api/document-types')
    }
    catch (error) {
      return void toast.add({ title: errorMessage(error), color: 'error' })
    }
    const type = defaultDocumentType(typeList.value, props.source.title)
    Object.assign(sheet, { typeId: type?.id ?? 0, confidential: type?.confidentialDefault ?? false })
  }
  else {
    if (!folders.value.includes(sheet.folder)) sheet.folder = folders.value[0] ?? 'correspondence'
  }
  sheetOpen.value = true
}

/** A new copy starts out with the confidentiality of its type. */
function onType(typeId: number) {
  sheet.typeId = typeId
  sheet.confidential = typeList.value.find(type => type.id === typeId)?.confidentialDefault ?? false
}

function saveFromSheet() {
  const target = props.target
  if (!target) return
  const title = sheet.title.trim()
  if (target.kind === 'child') {
    void persist({ mode: 'new-child', childId: target.id, meta: { typeId: sheet.typeId, title, documentDate: sheet.documentDate, confidential: sheet.confidential } })
  }
  else {
    void persist({ mode: 'new-employee', employeeId: target.id, meta: { folder: sheet.folder, title, documentDate: sheet.documentDate, note: '' } })
  }
}

async function persist(save: FillSave) {
  const doc = pdf
  if (!doc || busy.value) return
  busy.value = true
  try {
    const bytes = await doc.saveDocument()
    // The server checks the size and the file again.
    if (bytes.length > MAX_DOCUMENT_BYTES) return void toast.add({ title: de.errors.document_too_large, color: 'error' })
    const request = fillSaveRequest(save, new Blob([bytes], { type: 'application/pdf' }))
    await $fetch<unknown>(request.url, { method: request.method, body: request.body })
    touched.value = false
    sheetOpen.value = false
    toast.add({ title: de.common.saved, color: 'success' })
    open.value = false
    emit('saved')
  }
  catch (error) {
    toast.add({ title: errorMessage(error), color: 'error' })
  }
  finally {
    busy.value = false
  }
}

watch(open, (isOpen) => {
  if (isOpen) void load()
  else release()
}, { immediate: true })
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  clearTimeout(resizeTimer)
  endPrint()
  release()
})

const subtitle = computed(() => (props.target ? t.forTarget(props.target.name) : props.replace ? t.fillMore : ''))
</script>

<template>
  <UModal
    v-model:open="open" fullscreen :dismissible="false" :title="source.title" :description="subtitle || source.title"
    @close:prevent="requestClose"
  >
    <template #content>
      <div class="flex h-full min-h-0 flex-col bg-gray-100">
        <header class="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-3 py-2">
          <div class="min-w-0 flex-1">
            <h2 class="truncate font-semibold">{{ source.title }}</h2>
            <p v-if="subtitle" class="truncate text-sm text-gray-600">{{ subtitle }}</p>
          </div>
          <div class="flex flex-wrap items-center gap-1.5">
            <UButton color="neutral" variant="outline" icon="i-lucide-printer" :label="t.print" :disabled="busy || status === 'loading' || status === 'failed'" @click="print" />
            <UButton v-if="status === 'ready'" icon="i-lucide-save" :label="t.save" :loading="busy && !sheetOpen" :disabled="busy" @click="startSave" />
            <UButton color="neutral" variant="ghost" icon="i-lucide-x" :aria-label="t.close" :title="t.close" :disabled="busy" @click="requestClose" />
          </div>
        </header>

        <div v-if="pageCount" class="flex flex-wrap items-center justify-center gap-1.5 border-b border-gray-200 bg-white px-3 py-1.5 text-sm">
          <UButton color="neutral" variant="ghost" icon="i-lucide-chevron-left" :aria-label="t.previousPage" :disabled="pageNumber <= 1" @click="goTo(pageNumber - 1)" />
          <span class="min-w-28 text-center tabular-nums" aria-live="polite">{{ t.page(pageNumber, pageCount) }}</span>
          <UButton color="neutral" variant="ghost" icon="i-lucide-chevron-right" :aria-label="t.nextPage" :disabled="pageNumber >= pageCount" @click="goTo(pageNumber + 1)" />
          <span class="mx-2 h-5 w-px bg-gray-200" aria-hidden="true" />
          <UButton color="neutral" variant="ghost" icon="i-lucide-zoom-out" :aria-label="t.zoomOut" :title="t.zoomOut" :disabled="zoom <= ZOOMS[0]!" @click="zoomBy(-1)" />
          <UButton color="neutral" variant="ghost" :label="`${Math.round(zoom * 100)} %`" :aria-label="t.zoomFit" :title="t.zoomFit" @click="zoomFit" />
          <UButton color="neutral" variant="ghost" icon="i-lucide-zoom-in" :aria-label="t.zoomIn" :title="t.zoomIn" :disabled="zoom >= ZOOMS[ZOOMS.length - 1]!" @click="zoomBy(1)" />
        </div>

        <UAlert v-if="replace && status === 'ready'" class="rounded-none" color="info" variant="soft" :title="t.replaceHint[replace.kind]" />
        <UAlert v-if="status === 'noFields'" class="rounded-none" color="warning" variant="soft" :title="t.noFields" />

        <div ref="scrollEl" class="min-h-0 flex-1 overflow-auto p-2" @input="onInput" @change="onInput">
          <p v-if="status === 'loading'" class="p-4 text-sm text-gray-600">{{ t.opening }}</p>
          <p v-else-if="status === 'failed'" class="p-4 text-sm text-red-700" role="alert">{{ t.failed }}</p>
          <div v-show="status === 'ready' || status === 'noFields'" ref="pageEl" class="pdf-fill-page relative mx-auto bg-white shadow ring-1 ring-gray-200">
            <canvas ref="canvasEl" class="absolute inset-0 size-full" aria-hidden="true" />
            <div ref="layerEl" class="annotationLayer" />
          </div>
        </div>
      </div>

      <UModal v-model:open="sheetOpen" :title="t.saveTitle" :dismissible="!busy">
        <template #body>
          <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="saveFromSheet">
            <p class="text-sm text-gray-600 sm:col-span-2">
              {{ target?.kind === 'child' ? t.saveToChild(target.name) : t.saveToEmployee(target?.name ?? '') }}
            </p>
            <template v-if="target?.kind === 'child'">
              <p v-if="!typeList.length" class="text-sm text-gray-600 sm:col-span-2">{{ de.childDocuments.noTypes }}</p>
              <UFormField v-else :label="de.childDocuments.type" required>
                <USelect :model-value="sheet.typeId" :items="typeItems" class="w-full" @update:model-value="onType(Number($event))" />
              </UFormField>
            </template>
            <UFormField v-else :label="t.folder" required>
              <USelect v-model="sheet.folder" :items="folderItems" class="w-full" />
            </UFormField>
            <UFormField :label="de.childDocuments.date" required>
              <DateTextInput v-model="sheet.documentDate" :label="de.childDocuments.date" class="w-full" required />
            </UFormField>
            <UFormField :label="de.childDocuments.title" class="sm:col-span-2" required>
              <UInput v-model="sheet.title" maxlength="200" class="w-full" required />
            </UFormField>
            <UFormField v-if="target?.kind === 'child'" :label="de.childDocuments.visibility" class="sm:col-span-2">
              <USelect
                :model-value="sheet.confidential ? 'confidential' : 'all'"
                :items="[{ label: de.childDocuments.all, value: 'all' }, { label: de.childDocuments.confidential, value: 'confidential' }]"
                class="w-full" @update:model-value="sheet.confidential = $event === 'confidential'"
              />
            </UFormField>
            <div class="flex gap-2 sm:col-span-2">
              <UButton type="submit" :label="t.save" :loading="busy" :disabled="busy || (target?.kind === 'child' && !typeList.length)" />
              <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" :disabled="busy" @click="sheetOpen = false" />
            </div>
          </form>
        </template>
      </UModal>
    </template>
  </UModal>
</template>

<style>
/*
 * The fields of the form above the page (the part of pdf.js's viewer styles the annotation layer needs). Sizes follow
 * --total-scale-factor, which the page box sets for the zoom.
 */
.pdf-fill-page .annotationLayer {
  position: absolute;
  inset: 0 auto auto 0;
  pointer-events: none;
  transform-origin: 0 0;
  color-scheme: only light;
}
.pdf-fill-page .annotationLayer[data-main-rotation="90"] {
  transform: rotate(90deg) translateY(-100%);
}
.pdf-fill-page .annotationLayer[data-main-rotation="180"] {
  transform: rotate(180deg) translate(-100%, -100%);
}
.pdf-fill-page .annotationLayer[data-main-rotation="270"] {
  transform: rotate(270deg) translateX(-100%);
}
.pdf-fill-page .annotationLayer section {
  position: absolute;
  text-align: initial;
  pointer-events: auto;
  box-sizing: border-box;
  transform-origin: 0 0;
  user-select: none;
}
.pdf-fill-page .annotationLayer .hasOwnCanvas:not(.sandboxModified) :is(input, textarea) {
  /* A read-only field is drawn on its own canvas; it has nothing to type in. */
  display: none;
}
/* The looks pdf.js drew for a field lie under its input; taps go to the input. */
.pdf-fill-page .annotationLayer section canvas,
.pdf-fill-page .annotationLayer .annotationContent {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.pdf-fill-page .annotationLayer :is(.linkAnnotation, .buttonWidgetAnnotation.pushButton) > a {
  position: absolute;
  inset: 0;
}
.pdf-fill-page .annotationLayer :is(.textWidgetAnnotation :is(input, textarea), .choiceWidgetAnnotation select, .buttonWidgetAnnotation:is(.checkBox, .radioButton) input) {
  /* As an image: pdf.js sets the field's own background colour inline (often transparent). */
  background-image: linear-gradient(rgb(0 54 255 / 0.13), rgb(0 54 255 / 0.13));
  border: 2px solid transparent;
  box-sizing: border-box;
  font: calc(9px * var(--total-scale-factor)) sans-serif;
  height: 100%;
  width: 100%;
  margin: 0;
  padding: 0 2px;
  vertical-align: top;
  color: black;
}
.pdf-fill-page .annotationLayer .textWidgetAnnotation textarea {
  resize: none;
}
.pdf-fill-page .annotationLayer :is(.textWidgetAnnotation :is(input, textarea), .choiceWidgetAnnotation select):focus {
  background: none;
  border-color: #0284c7;
  border-radius: 2px;
  outline: none;
}
.pdf-fill-page .annotationLayer :is(input, textarea, select)[disabled] {
  background: none;
  cursor: not-allowed;
}
.pdf-fill-page .annotationLayer .textWidgetAnnotation input.comb {
  font-family: monospace;
  padding: 0;
}
.pdf-fill-page .annotationLayer .buttonWidgetAnnotation:is(.checkBox, .radioButton) input {
  appearance: none;
  padding: 0;
}
.pdf-fill-page .annotationLayer .buttonWidgetAnnotation.radioButton input {
  border-radius: 50%;
}
.pdf-fill-page .annotationLayer .buttonWidgetAnnotation:is(.checkBox, .radioButton) input:focus {
  border-color: #0284c7;
}
/* The looks pdf.js drew for the two states: only the current one shows. */
.pdf-fill-page .annotationLayer [data-canvas-name="checked"]:has(~ input:not(:checked)),
.pdf-fill-page .annotationLayer [data-canvas-name="unchecked"]:has(~ input:checked) {
  display: none;
}
/* A box without drawn looks gets a plain tick. */
.pdf-fill-page .annotationLayer .buttonWidgetAnnotation:is(.checkBox, .radioButton):not(:has([data-canvas-name])) input:checked {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3 8.5l3 3 7-7' fill='none' stroke='black' stroke-width='2'/%3E%3C/svg%3E"), linear-gradient(rgb(0 54 255 / 0.13), rgb(0 54 255 / 0.13));
  background-position: center;
  background-size: contain;
  background-repeat: no-repeat;
}
.pdf-fill-page .annotationLayer .popupAnnotation,
.pdf-fill-page .annotationLayer .popup {
  display: none;
}

/* Printing the filled form: only the rendered pages, one per sheet. */
.pdf-fill-print {
  display: none;
}
@media print {
  html.pdf-fill-printing body > *:not(.pdf-fill-print) {
    display: none !important;
  }
  html.pdf-fill-printing .pdf-fill-print {
    display: block;
  }
  html.pdf-fill-printing .pdf-fill-print img {
    display: block;
    width: 100%;
    height: auto;
    break-after: page;
  }
  html.pdf-fill-printing .pdf-fill-print img:last-child {
    break-after: auto;
  }
}
</style>
