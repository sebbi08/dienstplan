import { describe, expect, it } from 'vitest'
import { hasFormFields } from '../../server/lib/pdfForm'
import { fillablePdf, plainPdf } from '../helpers/fillablePdf'

/**
 * What „Ausfüllen“ of any PDF relies on in the installed pdfjs-dist (legacy build as in the app): an added text box
 * (what pdf.js's FreeText editor puts into the annotationStorage) is written by saveDocument() as a real FreeText
 * annotation, and the saved copy shows it again when it is opened (so it can be edited further). The tick, cross and
 * signature are stamps (images), which need a browser canvas; the smoke test in the browser covers them.
 */
type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs')

async function loadPdfJs(): Promise<PdfJs> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  // In Node pdf.js runs its worker in the same thread when the worker module is provided like this.
  ;(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
  return pdfjs
}

/** The serialized form of a FreeText editor (FreeTextEditor.serialize in pdf.js) for a new text box. */
const freeText = (pdfjs: PdfJs, value: string, rect: number[]) => ({
  annotationType: pdfjs.AnnotationEditorType.FREETEXT,
  pageIndex: 0, rect, rotation: 0, structTreeParentId: null, popupRef: '',
  color: [0, 0, 0], fontSize: 10, value, id: null,
})

describe('adding text to any PDF with pdf.js', () => {
  it('writes a text box into a plain PDF that the saved copy shows again', async () => {
    const pdfjs = await loadPdfJs()
    const task = pdfjs.getDocument({ data: new Uint8Array(plainPdf()), enableXfa: false })
    const document = await task.promise
    document.annotationStorage.setValue('pdfjs_internal_editor_0', freeText(pdfjs, 'Lena Kurz, Gruppe Füchse', [20, 150, 180, 165]))
    const saved = Buffer.from(await document.saveDocument())
    await task.destroy()

    // Only annotations: not a form („fillable“ stays as it is).
    expect(hasFormFields(saved)).toBe(false)
    const againTask = pdfjs.getDocument({ data: new Uint8Array(saved), enableXfa: false })
    const again = await againTask.promise
    const annotations = await (await again.getPage(1)).getAnnotations()
    const text = annotations.find(annotation => annotation.annotationType === pdfjs.AnnotationType.FREETEXT)
    expect(text?.contentsObj?.str).toBe('Lena Kurz, Gruppe Füchse')
    // pdf.js offers its own FreeText annotations for editing again (an editor type, no appearance lost).
    expect(text?.isEditable).toBe(true)
    expect(text?.hasAppearance).toBe(true)
    await againTask.destroy()
  }, 30_000)

  it('writes the signature footer at the bottom of the last page (its own storage key, next to the editors)', async () => {
    const { FOOTER_STORAGE_KEY, footerAnnotation } = await import('../../app/utils/pdfAnnotate')
    const pdfjs = await loadPdfJs()
    const task = pdfjs.getDocument({ data: new Uint8Array(plainPdf()), enableXfa: false })
    const document = await task.promise
    const page = await document.getPage(document.numPages)
    document.annotationStorage.setValue('pdfjs_internal_editor_0', freeText(pdfjs, 'Ort, Datum', [20, 150, 120, 165]))
    document.annotationStorage.setValue(FOOTER_STORAGE_KEY,
      footerAnnotation(pdfjs.AnnotationEditorType.FREETEXT, document.numPages - 1, page.view, 'Elektronisch unterschrieben von Anna Probe am 24.11.2026 10:15'))
    const saved = Buffer.from(await document.saveDocument())
    await task.destroy()

    const againTask = pdfjs.getDocument({ data: new Uint8Array(saved), enableXfa: false })
    const again = await againTask.promise
    const texts = (await (await again.getPage(again.numPages)).getAnnotations())
      .filter(annotation => annotation.annotationType === pdfjs.AnnotationType.FREETEXT)
    const footer = texts.find(annotation => annotation.contentsObj?.str?.startsWith('Elektronisch'))
    expect(footer?.contentsObj?.str).toBe('Elektronisch unterschrieben von Anna Probe am 24.11.2026 10:15')
    // At the bottom of the page box.
    expect(footer!.rect[1]).toBeLessThan(page.view[1]! + 40)
    expect(texts.map(annotation => annotation.contentsObj?.str)).toContain('Ort, Datum')
    await againTask.destroy()
  }, 30_000)

  it('keeps the form fields and their values next to the added text', async () => {
    const pdfjs = await loadPdfJs()
    const task = pdfjs.getDocument({ data: new Uint8Array(fillablePdf()), enableXfa: false })
    const document = await task.promise
    const annotations = await (await document.getPage(1)).getAnnotations()
    const nameId = annotations.find(annotation => annotation.fieldName === 'name')!.id as string
    document.annotationStorage.setValue(nameId, { value: 'Lena Kurz' })
    document.annotationStorage.setValue('pdfjs_internal_editor_0', freeText(pdfjs, 'gesehen', [20, 60, 120, 75]))
    const saved = Buffer.from(await document.saveDocument())
    await task.destroy()

    expect(hasFormFields(saved)).toBe(true)
    const againTask = pdfjs.getDocument({ data: new Uint8Array(saved), enableXfa: false })
    const again = await againTask.promise
    const fields = await again.getFieldObjects()
    expect((fields?.get('name')?.[0] as { value: unknown }).value).toBe('Lena Kurz')
    const texts = (await (await again.getPage(1)).getAnnotations()).filter(annotation => annotation.annotationType === pdfjs.AnnotationType.FREETEXT)
    expect(texts.map(annotation => annotation.contentsObj?.str)).toEqual(['gesehen'])
    await againTask.destroy()
  }, 30_000)
})
