import { de } from '~/locales/de'

/**
 * Filling any PDF in the fill view (app/components/pdf/FillDialog.vue): the tools above the page and the helpers they
 * use. The fill view runs pdf.js's own viewer with its annotation editors; what is added (text boxes, tick, cross,
 * signature) becomes real PDF annotations when pdf.js saves the copy. Form fields are filled with the tool „Felder“.
 */

/** „Felder“ (form fields), „Auswählen“ (move, resize, delete what was added), text box, tick, cross, signature. */
export type AnnotateTool = 'fields' | 'select' | 'text' | 'check' | 'cross' | 'signature'
export type MarkKind = 'check' | 'cross'

/** The pdf.js editor modes the tools use (AnnotationEditorType of pdfjs-dist). */
export interface EditorModes { NONE: number; FREETEXT: number; STAMP: number }

/**
 * The pdf.js editor mode of a tool: the fields need the forms layer (no editor); a text box is pdf.js's FreeText editor;
 * tick, cross and signature are pictures (its stamp editor), and choosing what was added works in that mode too, where
 * a tap on the free page creates nothing.
 */
export function editorModeFor(tool: AnnotateTool, modes: EditorModes): number {
  if (tool === 'fields') return modes.NONE
  if (tool === 'text') return modes.FREETEXT
  return modes.STAMP
}

/** The tools in the order of the bar; „Felder“ only for a PDF with form fields. */
export function annotateTools(hasFields: boolean): AnnotateTool[] {
  const tools: AnnotateTool[] = ['select', 'text', 'check', 'cross', 'signature']
  return hasFields ? ['fields', ...tools] : tools
}

/** Font sizes of a text box in points. */
export const FONT_SIZES = { small: 8, normal: 11, large: 15 } as const
export type FontSizeName = keyof typeof FONT_SIZES

/** The named size nearest to a text box's size (a box from elsewhere can have any size). */
export function fontSizeName(size: number): FontSizeName {
  const names = Object.keys(FONT_SIZES) as FontSizeName[]
  return names.reduce((best, name) => (Math.abs(FONT_SIZES[name] - size) < Math.abs(FONT_SIZES[best] - size) ? name : best), 'normal')
}

/** Zoom steps; 1 = the page as wide as the view. */
export const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3] as const

/** The next zoom step up or down from any zoom (pinching leaves values between the steps). */
export function nextZoom(current: number, step: 1 | -1): number {
  const near = (value: number) => Math.abs(value - current) < 0.01
  if (step > 0) return ZOOMS.find(value => value > current && !near(value)) ?? ZOOMS[ZOOMS.length - 1]!
  return [...ZOOMS].reverse().find(value => value < current && !near(value)) ?? ZOOMS[0]
}

/** Size of a tick or cross on the page in points (about the size of a printed box). */
export const MARK_POINTS = 14
/** Largest size of a placed signature in points (about 6 × 2.1 cm); it can be resized afterwards. */
export const SIGNATURE_POINTS = { width: 170, height: 60 } as const

/**
 * The size of a picture on the page, as pdf.js's stamp editor keeps it (shares of the page width and height): as large
 * as `box` allows, keeping the picture's proportions.
 */
export function stampSize(
  picture: { width: number; height: number }, page: { width: number; height: number }, box: { width: number; height: number },
): { width: number; height: number } {
  const factor = Math.min(box.width / picture.width, box.height / picture.height)
  return { width: (picture.width * factor) / page.width, height: (picture.height * factor) / page.height }
}

export interface Point { x: number; y: number }

/** The area the strokes cover plus `margin`, inside the pad; null for an empty pad. */
export function strokeBounds(
  strokes: readonly (readonly Point[])[], margin: number, pad: { width: number; height: number },
): { x: number; y: number; width: number; height: number } | null {
  const points = strokes.flat()
  if (!points.length) return null
  const xs = points.map(point => point.x)
  const ys = points.map(point => point.y)
  const x = Math.max(0, Math.floor(Math.min(...xs) - margin))
  const y = Math.max(0, Math.floor(Math.min(...ys) - margin))
  const right = Math.min(pad.width, Math.ceil(Math.max(...xs) + margin))
  const bottom = Math.min(pad.height, Math.ceil(Math.max(...ys) + margin))
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) }
}

/** The lines of a tick and of a cross in a square of side 1 (drawn into the picture that is placed). */
export const MARK_LINES: Record<MarkKind, [number, number][][]> = {
  check: [[[0.12, 0.55], [0.4, 0.82], [0.88, 0.18]]],
  cross: [[[0.16, 0.16], [0.84, 0.84]], [[0.84, 0.16], [0.16, 0.84]]],
}

/**
 * The methods of pdf.js's editor manager (AnnotationEditorUIManager) the fill view calls. They are not part of pdf.js's
 * typed API, so the fill view checks them before it offers the tools (tests/services/pdfjsContract.test.ts checks
 * them on the installed pdfjs-dist).
 */
export const EDITOR_MANAGER_METHODS = ['getLayer', 'undo', 'delete', 'commitOrRemove', 'updateParams'] as const

/** Whether an object from pdf.js has all the editor manager methods the fill view needs. */
export function isEditorManager(value: unknown): boolean {
  return typeof value === 'object' && value !== null
    && EDITOR_MANAGER_METHODS.every(name => typeof (value as Record<string, unknown>)[name] === 'function')
}

/** Whether a page's editor layer from pdf.js can take a new picture (AnnotationEditorLayer.createAndAddNewEditor). */
export function isEditorLayer(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const layer = value as Record<string, unknown>
  const dimensions = layer.pageDimensions
  return typeof layer.createAndAddNewEditor === 'function' && Array.isArray(dimensions) && dimensions.length === 2
    && layer.div instanceof Object && typeof layer.viewport === 'object' && layer.viewport !== null
}

/**
 * Lets an object answer calls of methods it does not have (a newer pdf.js asking its translations for something new):
 * they do nothing and resolve to undefined instead of throwing. `then` stays undefined, so the object is no promise.
 */
export function tolerant<T extends object>(target: T): T {
  return new Proxy(target, {
    get(object, name, receiver) {
      if (name in object) return Reflect.get(object, name, receiver)
      if (typeof name === 'symbol' || name === 'then') return undefined
      return async () => undefined
    },
  })
}

/**
 * The key of the footer line in pdf.js's annotationStorage: pdf.js writes only values whose key has its editor prefix
 * („pdfjs_internal_editor_“); the editors themselves number theirs, so a name cannot collide.
 */
export const FOOTER_STORAGE_KEY = 'pdfjs_internal_editor_signature_footer'

/**
 * The line „Elektronisch unterschrieben von … am …“ at the bottom of a page, as pdf.js's FreeText editor would hand it to
 * saveDocument (a real FreeText annotation in the saved PDF): 8 pt, black, 24 pt from the left and right edges and 12 pt
 * above the bottom of the page box `view` ([x0, y0, x1, y1] in PDF points).
 */
export function footerAnnotation(freeTextType: number, pageIndex: number, view: readonly number[], text: string) {
  const [x0 = 0, y0 = 0, x1 = 595] = view
  return {
    annotationType: freeTextType, pageIndex, rect: [x0 + 24, y0 + 12, x1 - 24, y0 + 24], rotation: 0,
    structTreeParentId: null, popupRef: '', color: [0, 0, 0], fontSize: 8, value: text, id: null,
  }
}

/** How far a finger may move during a tap that places a mark (CSS pixels). */
export const TAP_SLOP = 10

/**
 * Tells a tap on the free page (which places a tick or a cross) from pinching, scrolling or dragging: one finger (or
 * the mouse) only, pressed on the free page, lifted near where it was pressed.
 */
export function createTapTracker() {
  const down = new Map<number, Point>()
  let start: Point | null = null
  let spoiled = false
  return {
    /** A pointer goes down; `onPage`: on the free page (not on something added). */
    press(id: number, point: Point, onPage: boolean) {
      down.set(id, point)
      if (down.size === 1) {
        start = onPage ? point : null
        spoiled = !onPage
      }
      else {
        spoiled = true
      }
    },
    /** A pointer goes up: whether that was a tap on the free page (and where it began). */
    release(id: number, point: Point): Point | null {
      if (!down.delete(id)) return null
      const tap = !spoiled && down.size === 0 && start !== null
        && Math.hypot(point.x - start.x, point.y - start.y) <= TAP_SLOP
      const result = tap ? start : null
      if (down.size === 0) {
        start = null
        spoiled = false
      }
      return result
    },
    /** The browser took the pointer over (scrolling) or it left: no tap. */
    cancel(id: number) {
      down.delete(id)
      start = null
      spoiled = down.size > 0
    },
  }
}

/** Whether the element takes typing: a text box (pdf.js's editable div) or a form field. */
export function isTypingTarget(element: { isContentEditable: boolean; tagName: string } | null): boolean {
  return !!element && (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName))
}

/**
 * Whether a resized window fits the pages to the view's width again (zoom 1): only when the view got wider or narrower
 * (a turned tablet, a resized window, a scroll bar), not when only its height changed (the on-screen keyboard opening).
 * Never while a text box or a field is typed in: every scale change makes pdf.js finish the text box being typed in (an
 * empty one is removed), which takes the focus and closes the keyboard. Fitted at the next resize after typing.
 */
export function shouldRefit({ width, fittedWidth, typing }: { width: number; fittedWidth: number | null; typing: boolean }): boolean {
  if (typing) return false
  return fittedWidth === null || Math.abs(width - fittedWidth) >= 1
}

/** What the editors' state event of pdf.js („editingstateschanged“) says, as far as the bar needs it. */
export interface EditorState { canUndo: boolean; hasSelection: boolean }

/** The bar's state after a state event: pdf.js sends only what changed. */
export function nextEditorState(state: EditorState, details: { hasSomethingToUndo?: boolean; hasSelectedEditor?: boolean }): EditorState {
  return {
    canUndo: details.hasSomethingToUndo ?? state.canUndo,
    hasSelection: details.hasSelectedEditor ?? state.hasSelection,
  }
}

/**
 * German texts for the labels pdf.js puts on what was added (its `data-l10n-id`s: delete button, resize handles, the
 * text box with its placeholder, pictures, pages): the attributes to set, or null for one the fill view does not show.
 */
export function pdfjsTexts(id: string, args: Record<string, unknown> | null = null): Record<string, string> | null {
  const t = de.pdfFill.pdfjs
  if (id.startsWith('pdfjs-editor-remove-')) return { 'title': t.remove, 'aria-label': t.remove }
  if (id.startsWith('pdfjs-editor-resizer-')) return { 'aria-label': t.resize }
  if (id === 'pdfjs-free-text2') return { 'aria-label': t.textBox, 'default-content': t.textPlaceholder }
  if (id === 'pdfjs-editor-stamp-editor') return { 'aria-label': t.mark }
  if (id === 'pdfjs-page-landmark') return { 'aria-label': t.page(Number(args?.page) || 1) }
  return null
}

/** Sets the German texts on an element pdf.js labelled and on all such elements inside it. */
function translateTree(root: Element) {
  const elements = root.matches('[data-l10n-id]') ? [root, ...root.querySelectorAll('[data-l10n-id]')] : [...root.querySelectorAll('[data-l10n-id]')]
  for (const element of elements) {
    let args: Record<string, unknown> | null = null
    try {
      args = JSON.parse(element.getAttribute('data-l10n-args') ?? 'null') as Record<string, unknown> | null
    }
    catch {}
    const texts = pdfjsTexts(element.getAttribute('data-l10n-id') ?? '', args)
    for (const [name, value] of Object.entries(texts ?? {})) {
      if (element.getAttribute(name) !== value) element.setAttribute(name, value)
    }
  }
}

/**
 * What pdf.js's viewer asks of its translations (its L10n class, which would load Fluent files): German texts from
 * de.ts for what the fill view shows, kept up to date while pdf.js adds elements.
 */
export function createPdfjsL10n() {
  const observers: MutationObserver[] = []
  const text = (id: string, args: Record<string, unknown> | null) => {
    const texts = pdfjsTexts(id, args)
    return texts?.['aria-label'] ?? texts?.title
  }
  // Tolerant: a method a newer pdf.js may call on its translations does nothing instead of breaking the view.
  return tolerant({
    getLanguage: () => 'de',
    getDirection: () => 'ltr',
    async get(ids: string | string[], args: Record<string, unknown> | null = null, fallback?: string) {
      if (Array.isArray(ids)) return ids.map(id => text(id, null) ?? '')
      return text(ids, args) ?? fallback
    },
    async translate(element: HTMLElement) {
      translateTree(element)
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          if (record.type === 'attributes' && record.target instanceof Element) translateTree(record.target)
          for (const node of record.addedNodes) {
            if (node instanceof Element) translateTree(node)
          }
        }
      })
      observer.observe(element, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-l10n-id', 'data-l10n-args'] })
      observers.push(observer)
    },
    async translateOnce(element: HTMLElement) {
      translateTree(element)
    },
    pause() {},
    resume() {},
    async destroy() {
      for (const observer of observers.splice(0)) observer.disconnect()
    },
  })
}
