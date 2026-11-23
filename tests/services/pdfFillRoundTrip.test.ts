import { describe, expect, it } from 'vitest'
import { hasFormFields } from '../../server/lib/pdfForm'
import { fillablePdf } from '../helpers/fillablePdf'

/**
 * The pdf.js calls the fill view relies on (installed pdfjs-dist, legacy build as in the app): the field values live in
 * the document's annotationStorage, saveDocument() writes them into a copy, and that copy is still a form („Weiter
 * ausfüllen“) with the values in it.
 */
describe('filling a PDF form with pdf.js', () => {
  it('saves the typed values into a copy that is still fillable', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    // In Node pdf.js runs its worker in the same thread when the worker module is provided like this.
    ;(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
    const template = fillablePdf()
    const task = pdfjs.getDocument({ data: new Uint8Array(template), enableXfa: false })
    const document = await task.promise
    const fields = await document.getFieldObjects()
    expect([...(fields?.keys() ?? [])].sort()).toEqual(['agreed', 'name'])
    const annotations = await (await document.getPage(1)).getAnnotations()
    const id = (name: string) => annotations.find(annotation => annotation.fieldName === name)!.id as string
    document.annotationStorage.setValue(id('name'), { value: 'Lena Kurz' })
    document.annotationStorage.setValue(id('agreed'), { value: true })
    const saved = Buffer.from(await document.saveDocument())
    await task.destroy()

    expect(hasFormFields(saved)).toBe(true)
    const againTask = pdfjs.getDocument({ data: new Uint8Array(saved), enableXfa: false })
    const again = await againTask.promise
    const values = Object.fromEntries([...(await again.getFieldObjects())!.entries()].map(([name, [field]]) => [name, (field as { value: unknown }).value]))
    expect(values).toEqual({ name: 'Lena Kurz', agreed: 'Yes' })
    await againTask.destroy()
    // Loading pdf.js takes a few seconds while the whole suite runs in parallel.
  }, 30_000)
})
