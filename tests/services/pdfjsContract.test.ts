import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EDITOR_MANAGER_METHODS } from '../../app/utils/pdfAnnotate'

/**
 * The parts of pdf.js the fill view (app/components/pdf/FillDialog.vue) relies on beyond pdf.js's typed API. pdfjs-dist
 * is pinned (package.json, renovate.json); after an update this test fails if one of them is gone or renamed, before
 * anyone finds out in the browser. (The fill view also checks them at run time and keeps the fields working without
 * the tools; see the report „Fix round 1“.)
 */
const require = createRequire(import.meta.url)
const root = dirname(require.resolve('pdfjs-dist/package.json'))
const source = (path: string) => readFileSync(join(root, path), 'utf8')

describe('pdf.js contract of the fill view', () => {
  it('exports the classes and methods the tools call', async () => {
    const lib = await import('pdfjs-dist/legacy/build/pdf.mjs')
    expect(typeof lib.TouchManager).toBe('function')
    for (const name of EDITOR_MANAGER_METHODS) expect(typeof lib.AnnotationEditorUIManager.prototype[name as keyof typeof lib.AnnotationEditorUIManager.prototype], name).toBe('function')
    expect(typeof (lib.AnnotationEditorUIManager.prototype as unknown as { unselectAll: unknown }).unselectAll).toBe('function')
    expect(typeof lib.AnnotationEditorLayer.prototype.createAndAddNewEditor).toBe('function')
    expect(Object.getOwnPropertyDescriptor(lib.AnnotationEditorLayer.prototype, 'pageDimensions')?.get).toBeTypeOf('function')
    expect(lib.AnnotationEditorType).toMatchObject({ NONE: 0, FREETEXT: expect.any(Number), STAMP: expect.any(Number), DISABLE: -1 })
    expect(lib.AnnotationEditorParamsType).toMatchObject({ FREETEXT_SIZE: expect.any(Number), FREETEXT_COLOR: expect.any(Number) })
  }, 30_000)

  it('has the viewer events, the mode setter and the options the fill view uses', () => {
    const viewer = source('legacy/web/pdf_viewer.mjs')
    for (const event of ['annotationeditoruimanager', 'annotationeditormodechanged', 'annotationlayerrendered', 'annotationeditorlayerrendered',
      'pagesinit', 'pagerendered', 'pagechanging', 'scalechanging']) {
      expect(viewer, event).toContain(`"${event}"`)
    }
    expect(viewer).toContain('set annotationEditorMode({')
    expect(viewer).toMatch(/abortSignal\b/)
    const lib = source('legacy/build/pdf.mjs')
    expect(lib).toContain('src.BinaryDataFactory')
    expect(lib).toContain('"switchannotationeditormode"')
    expect(lib).toContain('"annotationeditorparamschanged"')
    expect(lib.includes('"editingstateschanged"') || lib.includes('"annotationeditorstateschanged"')).toBe(true)
    // The stamp editor keeps a width set before its picture is read (the size of tick, cross and signature).
    expect(lib).toMatch(/#createCanvas\(\) \{[\s\S]{0,300}if \(this\.width\)/)
  })

  it('bundles the decoder and font files pdf.js asks for, and they exist in pdfjs-dist', () => {
    const files = readFileSync(join(import.meta.dirname, '../../app/utils/pdfjsFiles.ts'), 'utf8')
    const imports = [...files.matchAll(/from 'pdfjs-dist\/([^']+)\?url'/g)].map(match => match[1]!)
    expect(imports.length).toBeGreaterThanOrEqual(4)
    for (const path of imports) expect(existsSync(join(root, path)), path).toBe(true)
    const worker = source('legacy/build/pdf.worker.mjs')
    for (const name of ['jbig2.wasm', 'openjpeg.wasm', 'FoxitDingbats.pfb', 'FoxitSymbol.pfb']) {
      expect(worker, name).toContain(`"${name}"`)
      expect(files, name).toContain(`'${name}'`)
    }
  })
})
