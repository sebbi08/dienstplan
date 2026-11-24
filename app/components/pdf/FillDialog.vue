<script setup lang="ts">
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { EventBus, PDFLinkService, PDFViewer } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs'
import { todayIso } from '#shared/domain/dates'
import type { EmployeeDocumentFolder } from '#shared/domain/personnel'
import type { DocumentTypeDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { MAX_DOCUMENT_BYTES } from '~/utils/children'
import { errorMessage } from '~/utils/errors'
import {
  annotateTools, createPdfjsL10n, createTapTracker, editorModeFor, FOOTER_STORAGE_KEY, footerAnnotation, isEditorLayer, isEditorManager, FONT_SIZES, fontSizeName, MARK_LINES, MARK_POINTS, nextEditorState, nextZoom,
  SIGNATURE_POINTS, stampSize, ZOOMS, type AnnotateTool, type EditorState, type FontSizeName, type MarkKind,
} from '~/utils/pdfAnnotate'
import { pdfjsFileOptions } from '~/utils/pdfjsFiles'
import { defaultDocumentType, fillSaveRequest, fillTitle, usableFolders, type FillKind, type FillSave, type FillSource, type FillTarget } from '~/utils/pdfFill'

/**
 * The fill view for any PDF: pdf.js's own viewer (pages one below the other, page buttons, zoom buttons and pinching)
 * with its form layer for the fields („Felder“) and its annotation editors for what is added anywhere on a page: text
 * boxes („Text“), a tick or a cross (pictures placed with a tap) and a signature (drawn in a pad, then placed and
 * resized). Everything lives only in the document's annotationStorage; „Speichern“ writes it into a copy
 * (saveDocument: the fields with their values, the additions as real PDF annotations) and sends it to the child's
 * record or the personnel file — as a new document (`target`: type or folder, title, date chosen in a small form) or in
 * place of the document it was opened from (`replace`, „Bearbeiten“), which then opens with its additions editable
 * again. „Drucken“ prints the pages with everything on them without saving. The template on the server never changes.
 * Closing (or leaving the page) with unsaved changes asks first. The file lives in memory only; pdf.js's scripting stays
 * off.
 */
const props = defineProps<{
  source: FillSource
  /** A new copy for this child or person. */
  target?: FillTarget
  /** The document the PDF was opened from („Bearbeiten“). */
  replace?: { kind: FillKind; documentId: number }
  /**
   * Instead of saving into a record: the PDF goes to `handler` (Zum Unterschreiben senden: the filled-in PDF to send;
   * Zu unterschreiben: the signed copy). `confirm` is asked first, `needsSignature` wants a placed signature, `footer`
   * is written at the bottom of the last page at that moment („Elektronisch unterschrieben von …“).
   */
  submit?: {
    label: string
    icon: string
    confirm?: string
    needsSignature?: boolean
    footer?: (at: Date) => string
    handler: (pdf: Blob) => Promise<void>
  }
  /** One more action in the header (Zu unterschreiben: „Nicht unterschreiben“); the view closes for it. */
  secondary?: { label: string; icon: string; handler: () => void }
  /** The line under the title (else „für …“ or „Gespeichertes PDF bearbeiten“). */
  subtitle?: string
  /** A note above the page (e.g. how to sign). */
  hint?: string
}>()
const open = defineModel<boolean>('open', { default: false })
/** `loadFailed`: the PDF could not be loaded (the caller may react to the error, e.g. the tablet's sign unlock is over). */
const emit = defineEmits<{ saved: []; loadFailed: [error: unknown] }>()

const toast = useToast()
const confirm = useConfirm()
const { can } = useCan()
const t = de.pdfFill

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')
type ViewerLib = typeof import('pdfjs-dist/legacy/web/pdf_viewer.mjs')
const status = ref<'loading' | 'ready' | 'failed'>('loading')
const hasFields = ref(false)
const pageNumber = ref(1)
const pageCount = ref(0)
/** 1 = the page as wide as the view (at most a comfortable size on a wide screen). */
const zoom = ref(1)
const touched = ref(false)
const busy = ref(false)
// Unsaved input keeps the page (useUnsavedGuard of the page) from being left without asking.
useDirty(() => touched.value)

// ---- tools ---------------------------------------------------------------
const tool = ref<AnnotateTool>('fields')
/**
 * The editors of the signatures placed in this view (their pdf.js ids, for `submit.needsSignature`). Deleting or undoing
 * one takes it out of the annotationStorage (redo puts it back), so only those still there count.
 */
let signatureIds = new Set<string>()
/** pdf.js's editors are ready (they start once the first page is there). */
const editorsReady = ref(false)
/**
 * pdf.js's editors did not start or failed (e.g. a pdf.js version whose internals differ): the tools other than
 * „Felder“ stay off with a note; filling fields, printing and saving go on.
 */
const editorsUnavailable = ref(false)
const editorState = ref<EditorState>({ canUndo: false, hasSelection: false })
const fontSize = ref<FontSizeName>('normal')
const padOpen = ref(false)
const tools = computed(() => annotateTools(hasFields.value))
const TOOL_ICONS: Record<AnnotateTool, string> = {
  fields: 'i-lucide-text-cursor-input', select: 'i-lucide-mouse-pointer-2', text: 'i-lucide-type', check: 'i-lucide-check',
  cross: 'i-lucide-x', signature: 'i-lucide-signature',
}

const containerEl = ref<HTMLDivElement | null>(null)
const viewerEl = ref<HTMLDivElement | null>(null)

/** What the fill view uses of pdf.js's editor manager and its per-page layers (not part of pdf.js's typed API). */
interface EditorLayer {
  div: HTMLDivElement
  pageDimensions: [number, number]
  viewport: { rotation: number }
  createAndAddNewEditor(point: { offsetX: number; offsetY: number }, isCentered: boolean, data?: Record<string, unknown>):
    { id: string; width: number | null; height: number | null } | null
}
interface EditorManager {
  getLayer(pageIndex: number): EditorLayer | undefined
  undo(): void
  delete(): void
  commitOrRemove(): void
  updateParams(type: number, value: unknown): void
}

let pdfjs: PdfJs | null = null
let loadingTask: PDFDocumentLoadingTask | null = null
let pdf: PDFDocumentProxy | null = null
let viewer: PDFViewer | null = null
let eventBus: EventBus | null = null
let linkService: PDFLinkService | null = null
let editors: EditorManager | null = null
let l10n: ReturnType<typeof createPdfjsL10n> | null = null
/** Ends the viewer's listeners (and the pinching) of the open document. */
let abort: AbortController | null = null
/** The scale of zoom 1. */
let baseScale = 1
/** The pictures of tick and cross (made once per opened document, shared by all marks: one image in the PDF). */
let marks = new Map<MarkKind, File>()
/** Counts loads; work that finds a newer number stops (closed or opened again). */
let generation = 0

/** At most this scale for zoom 1: a page on a wide screen stays readable instead of filling the whole width. */
const MAX_FIT_SCALE = 1.5
/** pdf.js's TextLayerMode.ENABLE: the text layer (pdf.js builds the structure tree with it, see start()). */
const TEXT_LAYER_ENABLE = 1
/** How long after the pages are there pdf.js's editors may take to start before the tools are given up. */
const EDITORS_WATCHDOG_MS = 8000
let editorsWatchdog: ReturnType<typeof setTimeout> | undefined
/** The tools were turned off only because the editors were slow to start (they may still come: see start()). */
let offBySlowStart = false

/** Turns the tools off (once) and says why in the console; the fields, printing and saving keep working. */
function disableEditors(reason: unknown, slowStart = false) {
  clearTimeout(editorsWatchdog)
  if (editorsUnavailable.value) {
    // A real failure after a slow start: no recovery any more.
    if (!slowStart) offBySlowStart = false
    return
  }
  offBySlowStart = slowStart
  console.warn('pdf.js editors not available:', reason)
  editorsUnavailable.value = true
  editorsReady.value = false
  editors = null
  tool.value = 'fields'
  try {
    if (viewer && pdfjs) viewer.annotationEditorMode = { mode: pdfjs.AnnotationEditorType.NONE }
  }
  catch {}
}

/** Runs a call into pdf.js's editors; if it throws, the tools are turned off instead of the view breaking. */
function safely<T>(action: () => T): T | undefined {
  try {
    return action()
  }
  catch (error) {
    disableEditors(error)
    return undefined
  }
}

function release() {
  generation++
  endPrint()
  abort?.abort()
  abort = null
  editorsReady.value = false
  editorsUnavailable.value = false
  offBySlowStart = false
  clearTimeout(editorsWatchdog)
  editors = null
  try {
    // Ends the editors, the drawn pages and the form layers of the document.
    viewer?.setDocument(null as unknown as PDFDocumentProxy)
  }
  catch {}
  viewer = null
  linkService?.setDocument(null)
  linkService = null
  eventBus = null
  void l10n?.destroy()
  l10n = null
  viewerEl.value?.replaceChildren()
  // Destroying the loading task also destroys its document (and everything typed or added with it).
  void loadingTask?.destroy()
  loadingTask = null
  pdf = null
  marks = new Map()
  pageCount.value = 0
}

async function load() {
  release()
  const current = generation
  status.value = 'loading'
  touched.value = false
  signatureIds = new Set()
  pageNumber.value = 1
  zoom.value = 1
  editorState.value = { canUndo: false, hasSelection: false }
  try {
    const response = await $fetch.raw<ArrayBuffer>(props.source.url, { responseType: 'arrayBuffer' })
    if (current !== generation) return
    const data = response._data
    if (!data) throw new Error('empty')
    // The legacy build carries the polyfills older tablet browsers need (as the document viewer). pdf.js's viewer
    // module takes the library from globalThis; its styles must be there before the editors start (they read them).
    const lib = await import('pdfjs-dist/legacy/build/pdf.mjs')
    lib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString()
    ;(globalThis as { pdfjsLib?: unknown }).pdfjsLib = lib
    const [viewerLib] = await Promise.all([import('pdfjs-dist/legacy/web/pdf_viewer.mjs'), import('pdfjs-dist/web/pdf_viewer.css')])
    if (current !== generation) return
    pdfjs = lib
    const task = lib.getDocument({ data: new Uint8Array(data), enableXfa: false, ...pdfjsFileOptions })
    loadingTask = task
    const doc = await task.promise
    if (current !== generation) return
    pdf = doc
    const fields = await doc.getFieldObjects()
    if (current !== generation) return
    hasFields.value = !!fields && fields.size > 0
    // pdf.js's own mode without editors first (for a PDF without fields no tool is chosen yet): switching right while
    // the first pages are drawn and fitted would leave additions saved before in the file unusable.
    tool.value = 'fields'
    pageCount.value = doc.numPages
    status.value = 'ready'
    await nextTick()
    if (current !== generation) return
    start(lib, viewerLib, doc)
  }
  catch (error) {
    if (current === generation) {
      release()
      status.value = 'failed'
      emit('loadFailed', error)
    }
  }
}

/** Shows the document in pdf.js's viewer, with its form layer and editors, and follows its events. */
function start(lib: PdfJs, viewerLib: ViewerLib, doc: PDFDocumentProxy) {
  const container = containerEl.value
  const viewerDiv = viewerEl.value
  if (!container || !viewerDiv) throw new Error('no view')
  const current = generation
  const bus = new viewerLib.EventBus()
  eventBus = bus
  abort = new AbortController()
  const links = new viewerLib.PDFLinkService({ eventBus: bus, externalLinkTarget: viewerLib.LinkTarget.BLANK, externalLinkRel: 'noopener noreferrer nofollow' })
  linkService = links
  l10n = createPdfjsL10n()
  // The text layer (pdf.js builds the structure tree with it, which its editors need to reopen pictures added before),
  // the forms layer for the fields, the editors on (`abortSignal` is missing in its types).
  const options = {
    container, viewer: viewerDiv, eventBus: bus, linkService: links, l10n: l10n as never,
    textLayerMode: TEXT_LAYER_ENABLE, annotationMode: lib.AnnotationMode.ENABLE_FORMS,
    annotationEditorMode: lib.AnnotationEditorType.NONE, enableAutoLinking: false, supportsPinchToZoom: true, abortSignal: abort.signal,
  }
  type ViewerOptions = ConstructorParameters<ViewerLib['PDFViewer']>[0]
  let view: PDFViewer
  try {
    view = new viewerLib.PDFViewer(options as ViewerOptions)
  }
  catch (error) {
    // Once more without the editors and with pdf.js's own translations: the fields still work.
    disableEditors(error)
    viewerDiv.replaceChildren()
    const { l10n: _ours, ...plain } = options
    view = new viewerLib.PDFViewer({ ...plain, annotationEditorMode: lib.AnnotationEditorType.DISABLE } as ViewerOptions)
  }
  viewer = view
  links.setViewer(view)

  // The tools work once pdf.js's editor manager is there and a page has its annotations drawn: switching modes earlier
  // would not know which annotations of the file (added before) to hand over to the editors.
  let manager: EditorManager | null = null
  let layerDrawn = false
  const ready = () => {
    if (current !== generation || !manager || !layerDrawn || editorsReady.value) return
    // Turned off for a real failure: stays off. Turned off only by the watchdog (a slow first page): back on now.
    if (editorsUnavailable.value && !offBySlowStart) return
    if (!isEditorManager(manager)) return disableEditors('the editor manager lacks a method the fill view uses')
    clearTimeout(editorsWatchdog)
    editorsUnavailable.value = false
    offBySlowStart = false
    editors = manager
    editorsReady.value = true
  }
  bus.on('annotationeditoruimanager', ({ uiManager }: { uiManager: EditorManager }) => {
    manager = uiManager
    ready()
  })
  bus.on('annotationlayerrendered', () => {
    layerDrawn = true
    ready()
  })
  bus.on('pagesinit', () => {
    if (current === generation) fitWidth()
  })
  // The watchdog counts from the first drawn page (a big scan on an old tablet can take long to draw; the editors
  // start only after it). If they come later anyway, ready() turns the tools back on.
  let watching = false
  bus.on('pagerendered', () => {
    if (current !== generation || watching) return
    watching = true
    clearTimeout(editorsWatchdog)
    editorsWatchdog = setTimeout(() => {
      if (current === generation && !editorsReady.value) disableEditors('the editors did not start in time', true)
    }, EDITORS_WATCHDOG_MS)
  })
  bus.on('pagechanging', ({ pageNumber: number }: { pageNumber: number }) => {
    pageNumber.value = number
  })
  bus.on('scalechanging', ({ scale }: { scale: number }) => {
    zoom.value = Math.round((scale / baseScale) * 100) / 100
  })
  // What can be undone or deleted (the event's name differs between pdf.js versions).
  const onStates = ({ details }: { details: { hasSomethingToUndo?: boolean; hasSelectedEditor?: boolean } }) => {
    editorState.value = nextEditorState(editorState.value, details)
  }
  bus.on('editingstateschanged', onStates)
  bus.on('annotationeditorstateschanged', onStates)
  bus.on('annotationeditorparamschanged', ({ details }: { details: [number, unknown][] }) => {
    for (const [type, value] of details) {
      if (type === lib.AnnotationEditorParamsType.FREETEXT_SIZE && typeof value === 'number') fontSize.value = fontSizeName(value)
    }
  })
  // pdf.js asks for another mode itself, e.g. when a text box is tapped while choosing: the matching tool, and the
  // request as it is (with the editor to select or edit, which a bare mode switch would unselect).
  bus.on('switchannotationeditormode', ({ source: _source, ...request }: { source: unknown; mode: number; editId?: string | null }) => {
    if (!editors) return
    if (request.mode === lib.AnnotationEditorType.FREETEXT) tool.value = 'text'
    else if (request.mode === lib.AnnotationEditorType.STAMP) tool.value = 'select'
    else return
    safely(() => {
      // New text boxes get the chosen size and colour also when pdf.js chose the text tool: unselected first, so these
      // become the defaults; pdf.js selects the requested editor again after switching.
      if (request.mode === lib.AnnotationEditorType.FREETEXT) {
        ;(editors as { unselectAll?: () => void } | null)?.unselectAll?.()
        textDefaults(lib)
      }
      view.annotationEditorMode = request
    })
  })
  // Every typed value and every change of an addition counts as unsaved.
  ;(doc.annotationStorage as { onSetModified: (() => void) | null }).onSetModified = () => {
    if (current === generation) touched.value = true
  }

  // Pinching zooms the pages (pdf.js's touch handling of its own viewer app). Without it the zoom buttons remain.
  let pinchFactor = 1
  try {
    if (typeof lib.TouchManager !== 'function') throw new Error('TouchManager missing')
    new lib.TouchManager({
      container,
      signal: abort.signal,
      onPinching: (origin: [number, number], previous: number, distance: number) => {
        pinchFactor *= distance / previous
        const scale = view.currentScale
        const wanted = Math.min(baseScale * ZOOMS[ZOOMS.length - 1]!, Math.max(baseScale * ZOOMS[0], scale * pinchFactor))
        if (Math.abs(wanted - scale) < 0.01) return
        pinchFactor = 1
        view.updateScale({ scaleFactor: wanted / scale, origin, drawingDelay: 400 })
      },
      onPinchEnd: () => {
        pinchFactor = 1
      },
    })
  }
  catch (error) {
    console.warn('pdf.js pinch zoom not available:', error)
  }

  view.setDocument(doc)
  links.setDocument(doc, null)
}

/** Zoom 1: the page as wide as the view, at most MAX_FIT_SCALE. */
function fitWidth() {
  const view = viewer
  if (!view?.pagesCount) return
  view.currentScaleValue = 'page-width'
  baseScale = Math.min(view.currentScale, MAX_FIT_SCALE)
  if (view.currentScale !== baseScale) view.currentScale = baseScale
  zoom.value = 1
}

function goTo(number: number) {
  if (!viewer || number < 1 || number > pageCount.value) return
  viewer.currentPageNumber = number
}
function zoomBy(step: 1 | -1) {
  if (!viewer) return
  const next = nextZoom(zoom.value, step)
  if (next === zoom.value) return
  viewer.currentScale = baseScale * next
}
function zoomFit() {
  fitWidth()
}

// A turned phone or a resized window: zoom 1 fits the new width again, another zoom stays relative to it.
let resizeTimer: ReturnType<typeof setTimeout> | undefined
function onResize() {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    const view = viewer
    if (!view?.pagesCount) return
    const wanted = zoom.value
    fitWidth()
    if (wanted !== 1) view.currentScale = baseScale * wanted
  }, 200)
}
onMounted(() => window.addEventListener('resize', onResize))

// ---- adding text, marks and the signature --------------------------------
/** Switches pdf.js's editor mode and waits until it is there (switching from the fields redraws the pages first). */
function editorMode(mode: number): Promise<void> {
  const view = viewer
  const bus = eventBus
  if (!view || !bus || !editors) return Promise.resolve()
  // The getter gives the mode itself (its types say otherwise).
  if (safely(() => (view.annotationEditorMode as unknown as number) === mode) !== false) return Promise.resolve()
  return new Promise((resolve) => {
    const done = ({ mode: reached }: { mode: number }) => {
      if (reached !== mode) return
      bus.off('annotationeditormodechanged', done)
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      bus.off('annotationeditormodechanged', done)
      resolve()
    }, 3000)
    bus.on('annotationeditormodechanged', done)
    safely(() => {
      view.annotationEditorMode = { mode }
    })
  })
}

/** New text boxes: the chosen size, in black (applies to the selected text box instead when one is selected). */
function textDefaults(lib: PdfJs) {
  editors?.updateParams(lib.AnnotationEditorParamsType.FREETEXT_SIZE, FONT_SIZES[fontSize.value])
  editors?.updateParams(lib.AnnotationEditorParamsType.FREETEXT_COLOR, '#000000')
}

/** pdf.js marks additions it only reopened from the file as changed: `touched` stays only for real changes. */
function recheckTouched() {
  if (touched.value && !hasChanges()) touched.value = false
}

async function useTool(next: AnnotateTool) {
  const lib = pdfjs
  if (!lib || !editors) return
  if (next === 'signature') {
    padOpen.value = true
    return
  }
  tool.value = next
  await editorMode(editorModeFor(next, lib.AnnotationEditorType))
  // Nothing is selected right after switching, so these are the defaults for new text boxes.
  if (next === 'text') safely(() => textDefaults(lib))
  recheckTouched()
}

/** The size of new text boxes, and of the selected one. */
function chooseFontSize(name: FontSizeName) {
  fontSize.value = name
  const lib = pdfjs
  if (lib) safely(() => editors?.updateParams(lib.AnnotationEditorParamsType.FREETEXT_SIZE, FONT_SIZES[name]))
}

/** The picture of a tick or a cross: black lines on a transparent square, sharp enough for print. */
async function markPicture(kind: MarkKind): Promise<File | null> {
  const known = marks.get(kind)
  if (known) return known
  const size = 96
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) return null
  context.strokeStyle = '#000000'
  context.lineWidth = size * 0.11
  context.lineCap = 'round'
  context.lineJoin = 'round'
  for (const line of MARK_LINES[kind]) {
    context.beginPath()
    line.forEach(([x, y], index) => (index === 0 ? context.moveTo(x * size, y * size) : context.lineTo(x * size, y * size)))
    context.stroke()
  }
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) return null
  const file = new File([blob], kind === 'check' ? 'Haekchen.png' : 'Kreuz.png', { type: 'image/png' })
  marks.set(kind, file)
  return file
}

/**
 * Puts a picture centred on a point of a page, at most `box` points large (it can be moved and resized afterwards).
 * Answers the editor's pdf.js id, or null when nothing was placed.
 */
function placePicture(
  layer: EditorLayer, point: { offsetX: number; offsetY: number }, picture: { file: File; width: number; height: number },
  box: { width: number; height: number },
): string | null {
  if (!isEditorLayer(layer)) {
    disableEditors('the page layer cannot take pictures')
    return null
  }
  const editor = safely(() => layer.createAndAddNewEditor(point, true, { bitmapFile: picture.file }))
  if (!editor) return null
  const [width, height] = layer.pageDimensions
  // pdf.js would show the picture as large as its pixels; the size it should have, before the picture is read.
  Object.assign(editor, stampSize(picture, { width, height }, box))
  return typeof editor.id === 'string' ? editor.id : null
}

/**
 * A tap on the free page with „Häkchen“ or „Kreuz“ places the mark there (a tap on an addition selects it instead;
 * pinching, scrolling and dragging place nothing).
 */
const taps = createTapTracker()
const onFreePage = (event: PointerEvent) => (event.target as HTMLElement | null)?.classList?.contains('annotationEditorLayer') ?? false
function onPagePointerDown(event: PointerEvent) {
  taps.press(event.pointerId, { x: event.clientX, y: event.clientY }, onFreePage(event) && !(event.pointerType === 'mouse' && event.button !== 0))
}
function onPagePointerCancel(event: PointerEvent) {
  taps.cancel(event.pointerId)
}
async function onPagePointerUp(event: PointerEvent) {
  const tapped = taps.release(event.pointerId, { x: event.clientX, y: event.clientY })
  const target = event.target as HTMLElement | null
  const kind = tool.value
  if (!tapped || !editors || (kind !== 'check' && kind !== 'cross') || !target || !onFreePage(event)) return
  const number = Number(target.closest('.page')?.getAttribute('data-page-number'))
  const layer = safely(() => editors?.getLayer(number - 1))
  const point = { offsetX: event.offsetX, offsetY: event.offsetY }
  const file = await markPicture(kind)
  if (!layer || !file) return
  placePicture(layer, point, { file, width: 96, height: 96 }, { width: MARK_POINTS, height: MARK_POINTS })
}

/** The middle of the visible part of a page's layer, in the layer's own coordinates (as pdf.js places a new picture). */
function visibleMiddle(layer: EditorLayer): { offsetX: number; offsetY: number } {
  const box = layer.div.getBoundingClientRect()
  const view = containerEl.value?.getBoundingClientRect() ?? box
  const left = Math.max(box.left, view.left)
  const right = Math.min(box.right, view.right)
  const top = Math.max(box.top, view.top)
  const bottom = Math.min(box.bottom, view.bottom)
  const x = (left + right) / 2 - box.left
  const y = (top + bottom) / 2 - box.top
  return layer.viewport.rotation % 180 === 0 ? { offsetX: x, offsetY: y } : { offsetX: y, offsetY: x }
}

/** The page's editor layer; a page drawn only just now gets its layer a moment later (waits for it once). */
async function pageLayer(index: number): Promise<EditorLayer | undefined> {
  const found = safely(() => editors?.getLayer(index))
  if (found || !eventBus) return found
  const bus = eventBus
  await new Promise<void>((resolve) => {
    const done = () => {
      bus.off('annotationeditorlayerrendered', done)
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(done, 2000)
    bus.on('annotationeditorlayerrendered', done)
  })
  return safely(() => editors?.getLayer(index))
}

/** The signature from the pad: on the page in view, in its middle, to be moved to its place (or a message). */
async function placeSignature(picture: { file: File; width: number; height: number }) {
  const lib = pdfjs
  let placed: string | null = null
  if (lib && editors) {
    tool.value = 'select'
    await editorMode(lib.AnnotationEditorType.STAMP)
    const layer = editors ? await pageLayer(pageNumber.value - 1) : undefined
    if (layer) placed = placePicture(layer, visibleMiddle(layer), picture, SIGNATURE_POINTS)
  }
  if (placed) signatureIds.add(placed)
  else toast.add({ title: t.signatureFailed, color: 'error' })
}

/** The signatures placed here that are still on the page (deleted or undone ones are gone from the annotationStorage). */
function signaturesOnPage(): number {
  const storage = pdf?.annotationStorage
  if (!storage) return 0
  return [...signatureIds].filter(id => storage.getRawValue(id) !== undefined).length
}

function deleteSelected() {
  safely(() => editors?.delete())
}
function undo() {
  safely(() => editors?.undo())
}

/**
 * Enter or Space in the pages (the free page, a selected tick or signature, the scroll box) would make pdf.js's picture
 * editor ask for any image file; the fill view only places its own tick, cross and signature. Typing in a field or a
 * text box is left alone; an editor's own Enter handling runs on the editor before this.
 */
function onViewKeydown(event: KeyboardEvent) {
  if ((event.key !== 'Enter' && event.key !== ' ') || !['select', 'check', 'cross'].includes(tool.value)) return
  const target = event.target as HTMLElement | null
  if (!target || !containerEl.value?.contains(target)) return
  if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
  event.preventDefault()
  event.stopPropagation()
}

/** A text box being typed in is finished first, so saving and printing take what is on screen. */
function finishEditing() {
  try {
    editors?.commitOrRemove()
  }
  catch {}
}

/** Whether anything was typed or changed (pdf.js also marks additions it only reopened from the file). */
function hasChanges(): boolean {
  const storage = pdf?.annotationStorage
  if (!storage) return false
  try {
    finishEditing()
    const { map, transfer } = storage.serializable as { map: Map<string, unknown> | null; transfer?: { close?: () => void }[] }
    for (const bitmap of transfer ?? []) bitmap.close?.()
    return (map?.size ?? 0) > 0
  }
  catch {
    return true
  }
}

/**
 * A question of the app (ConfirmDialog, outside this modal) is open: moving the focus there makes the modal ask to close
 * (close:prevent), which must not answer it or ask again.
 */
let asking = false
async function ask(message: string, confirmLabel: string, danger: boolean): Promise<boolean> {
  asking = true
  try {
    return await confirm(message, { confirmLabel, danger })
  }
  finally {
    asking = false
  }
}

async function requestClose() {
  if (busy.value || asking) return
  recheckTouched()
  if (touched.value && !(await ask(t.unsavedConfirm, t.unsavedLeave, true))) return
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
 * Prints the pages with the typed values and the additions (drawn as pdf.js prints them), without saving anything. One
 * page at a time is drawn on a canvas, which is emptied right after it became a compressed image; the browser decodes
 * the images only to print them.
 */
async function print() {
  const lib = pdfjs
  const doc = pdf
  if (!lib || !doc || busy.value) return
  busy.value = true
  endPrint()
  finishEditing()
  // Closed (or reopened) meanwhile: the document is gone; stop quietly and drop what was drawn.
  const current = generation
  const stale = () => current !== generation
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
      if (stale()) return void endPrint()
    }
    if (stale()) return void endPrint()
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
    if (!stale()) toast.add({ title: t.printFailed, color: 'error' })
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
  finishEditing()
  if (props.submit) return void startSubmit(props.submit)
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

/** `submit`: the checks and the question first, then the PDF (with the footer, if any) to the handler. */
async function startSubmit(submit: NonNullable<typeof props.submit>) {
  if (submit.needsSignature && signaturesOnPage() === 0) return void toast.add({ title: de.signRequests.signatureMissing, color: 'warning' })
  if (submit.confirm && !(await ask(submit.confirm, submit.label, false))) return
  const lib = pdfjs
  const doc = pdf
  if (!lib || !doc || busy.value) return
  busy.value = true
  const storage = doc.annotationStorage
  try {
    finishEditing()
    if (submit.footer) {
      const page = await doc.getPage(doc.numPages)
      storage.setValue(FOOTER_STORAGE_KEY, footerAnnotation(lib.AnnotationEditorType.FREETEXT, doc.numPages - 1, page.view, submit.footer(new Date())))
    }
    const bytes = await doc.saveDocument()
    if (bytes.length > MAX_DOCUMENT_BYTES) return void toast.add({ title: t.tooLarge, color: 'error' })
    await submit.handler(new Blob([bytes], { type: 'application/pdf' }))
    touched.value = false
    open.value = false
  }
  catch (error) {
    toast.add({ title: errorMessage(error), color: 'error' })
  }
  finally {
    // The footer is written only into the copy that was handed over.
    if (submit.footer) storage.remove(FOOTER_STORAGE_KEY)
    busy.value = false
  }
}

/** The second action: the view closes without saving (nothing of it is kept). */
function runSecondary() {
  const action = props.secondary
  if (!action || busy.value) return
  touched.value = false
  open.value = false
  action.handler()
}

async function persist(save: FillSave) {
  const doc = pdf
  if (!doc || busy.value) return
  busy.value = true
  try {
    finishEditing()
    const bytes = await doc.saveDocument()
    // The server checks the size and the file again.
    if (bytes.length > MAX_DOCUMENT_BYTES) return void toast.add({ title: t.tooLarge, color: 'error' })
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

const subtitle = computed(() => props.subtitle ?? (props.target ? t.forTarget(props.target.name) : props.replace ? t.editing : ''))
const toolHint = computed(() => (tool.value === 'fields' && !hasFields.value ? '' : t.toolHint[tool.value]))
</script>

<template>
  <UModal
    v-model:open="open" fullscreen :dismissible="false" :title="source.title" :description="subtitle || source.title"
    @close:prevent="requestClose"
  >
    <template #content>
      <!--
        pdf.js listens on the whole document while an editing tool is on: copy/cut/paste and dropped files would become
        pictures on the page and block copying in the inputs. Stopped here (the browser's own copy and paste stay).
      -->
      <div
        class="flex h-full min-h-0 flex-col bg-gray-100" @copy.stop @cut.stop @paste.stop @dragover.prevent.stop @drop.prevent.stop
        @keydown="onViewKeydown"
      >
        <header class="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-3 py-2">
          <div class="min-w-0 flex-1">
            <h2 class="truncate font-semibold">{{ source.title }}</h2>
            <p v-if="subtitle" class="truncate text-sm text-gray-600">{{ subtitle }}</p>
          </div>
          <div class="flex flex-wrap items-center gap-1.5">
            <UButton color="neutral" variant="outline" icon="i-lucide-printer" :label="t.print" :disabled="busy || status !== 'ready'" @click="print" />
            <UButton
              v-if="secondary" color="neutral" variant="outline" :icon="secondary.icon" :label="secondary.label" :disabled="busy"
              @click="runSecondary"
            />
            <UButton
              :icon="submit?.icon ?? 'i-lucide-save'" :label="submit?.label ?? t.save" :loading="busy && !sheetOpen" :disabled="busy || status !== 'ready'"
              @click="startSave"
            />
            <UButton color="neutral" variant="ghost" icon="i-lucide-x" :aria-label="t.close" :title="t.close" :disabled="busy" @click="requestClose" />
          </div>
        </header>

        <div v-if="status === 'ready'" class="border-b border-gray-200 bg-white px-2 py-1.5">
          <!-- The tools: one row that scrolls sideways on a phone. -->
          <div role="toolbar" :aria-label="t.tools" class="flex items-center gap-1 overflow-x-auto">
            <UButton
              v-for="entry in tools" :key="entry" size="sm" :icon="TOOL_ICONS[entry]" :label="t.tool[entry]"
              :color="tool === entry ? 'primary' : 'neutral'" :variant="tool === entry ? 'soft' : 'ghost'" class="shrink-0"
              :aria-pressed="entry === 'signature' ? undefined : tool === entry" :disabled="!editorsReady && entry !== 'fields'"
              @click="useTool(entry)"
            />
            <span class="mx-1 h-6 w-px shrink-0 bg-gray-200" aria-hidden="true" />
            <UButton
              size="sm" color="neutral" variant="ghost" icon="i-lucide-trash-2" :label="t.deleteItem" :title="t.deleteItemHint" class="shrink-0"
              :disabled="!editorState.hasSelection" @click="deleteSelected"
            />
            <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-undo-2" :label="t.undo" class="shrink-0" :disabled="!editorState.canUndo" @click="undo" />
          </div>
          <div v-if="tool === 'text'" role="group" :aria-label="t.fontSize" class="mt-1 flex items-center gap-1 text-sm">
            <span class="px-1 text-gray-600">{{ t.fontSize }}:</span>
            <UButton
              v-for="name in (['small', 'normal', 'large'] as const)" :key="name" size="xs" :label="t.fontSizes[name]"
              :color="fontSize === name ? 'primary' : 'neutral'" :variant="fontSize === name ? 'soft' : 'ghost'" :aria-pressed="fontSize === name"
              @click="chooseFontSize(name)"
            />
          </div>
          <p v-if="toolHint" class="mt-1 px-1 text-xs text-gray-600" aria-live="polite">{{ toolHint }}</p>
        </div>

        <div v-if="pageCount" class="flex flex-wrap items-center justify-center gap-1.5 border-b border-gray-200 bg-white px-3 py-1 text-sm">
          <UButton color="neutral" variant="ghost" icon="i-lucide-chevron-left" :aria-label="t.previousPage" :disabled="pageNumber <= 1" @click="goTo(pageNumber - 1)" />
          <span class="min-w-28 text-center tabular-nums" aria-live="polite">{{ t.page(pageNumber, pageCount) }}</span>
          <UButton color="neutral" variant="ghost" icon="i-lucide-chevron-right" :aria-label="t.nextPage" :disabled="pageNumber >= pageCount" @click="goTo(pageNumber + 1)" />
          <span class="mx-2 h-5 w-px bg-gray-200" aria-hidden="true" />
          <UButton color="neutral" variant="ghost" icon="i-lucide-zoom-out" :aria-label="t.zoomOut" :title="t.zoomOut" :disabled="zoom <= ZOOMS[0] + 0.001" @click="zoomBy(-1)" />
          <UButton color="neutral" variant="ghost" :label="`${Math.round(zoom * 100)} %`" :aria-label="t.zoomFit" :title="t.zoomFit" @click="zoomFit" />
          <UButton color="neutral" variant="ghost" icon="i-lucide-zoom-in" :aria-label="t.zoomIn" :title="t.zoomIn" :disabled="zoom >= ZOOMS[ZOOMS.length - 1]! - 0.001" @click="zoomBy(1)" />
        </div>

        <UAlert v-if="replace && status === 'ready'" class="rounded-none" color="info" variant="soft" :title="t.replaceHint[replace.kind]" />
        <UAlert v-if="hint && status === 'ready'" class="rounded-none" color="info" variant="soft" :title="hint" />
        <UAlert v-if="status === 'ready' && editorsUnavailable" class="rounded-none" color="warning" variant="soft" :title="t.toolsUnavailable" />
        <UAlert v-else-if="status === 'ready' && !hasFields && !hint" class="rounded-none" color="info" variant="soft" :title="t.noFields" />

        <div class="relative min-h-0 flex-1">
          <p v-if="status === 'loading'" class="p-4 text-sm text-gray-600">{{ t.opening }}</p>
          <p v-else-if="status === 'failed'" class="p-4 text-sm text-red-700" role="alert">{{ t.failed }}</p>
          <!-- pdf.js's viewer needs an absolutely placed scroll box with the pages' box as its first child. -->
          <div
            v-show="status === 'ready'" ref="containerEl" class="pdf-fill-view absolute inset-0 overflow-auto"
            @pointerdown="onPagePointerDown" @pointerup="onPagePointerUp" @pointercancel="onPagePointerCancel"
          >
            <div ref="viewerEl" class="pdfViewer" />
          </div>
        </div>
      </div>

      <PdfSignaturePad v-model:open="padOpen" @done="placeSignature" />

      <UModal v-model:open="sheetOpen" :title="t.saveTitle" :dismissible="!busy">
        <template #body>
          <form
            class="grid gap-3 sm:grid-cols-2" @submit.prevent="saveFromSheet" @copy.stop @cut.stop @paste.stop
            @dragover.prevent.stop @drop.prevent.stop
          >
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
 * pdf.js's viewer styles (pdfjs-dist/web/pdf_viewer.css) come with the fill view; here only what differs: light colours
 * always, pinching handled by the viewer (not the browser), and of the editors' small toolbar only the delete button
 * (no colours, alt text or comments).
 */
/* pdf.js's styles set `:root { color-scheme: light dark }`; the app stays light (doubled for precedence). */
:root:root {
  color-scheme: light;
}
.pdf-fill-view {
  color-scheme: only light;
  touch-action: pan-x pan-y;
}
.pdf-fill-view .editToolbar :is(.colorPicker, .basicColorPicker, .altText, .comment, .divider) {
  display: none !important;
}
/* The editor layer's large font size (pdf.js scales text boxes with it) would push the delete icon off its button. */
.pdf-fill-view .editToolbar {
  font-size: 12px;
  line-height: 1;
}
.pdf-fill-view .editToolbar .basic::before {
  vertical-align: top;
}
.pdf-fill-view .annotationLayer :is(.popupAnnotation, .popup) {
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
