import openjpegWasm from 'pdfjs-dist/wasm/openjpeg.wasm?url'
import jbig2Wasm from 'pdfjs-dist/wasm/jbig2.wasm?url'
import qcmsWasm from 'pdfjs-dist/wasm/qcms_bg.wasm?url'
import dingbatsFont from 'pdfjs-dist/standard_fonts/FoxitDingbats.pfb?url'
import symbolFont from 'pdfjs-dist/standard_fonts/FoxitSymbol.pfb?url'

/**
 * The extra files pdf.js 6 loads while drawing some PDFs: decoders for scanned pages (JBIG2, JPEG 2000) and colour
 * profiles as WebAssembly, and the Symbol and ZapfDingbats fonts (the ticks of many form checkboxes). They come with the
 * build (each under its own hashed name), so pdf.js gets them through this factory instead of a folder URL. Without
 * them a scan drawn with such a decoder shows as an empty page.
 */
const FILES: Record<string, Record<string, string>> = {
  wasmUrl: { 'openjpeg.wasm': openjpegWasm, 'jbig2.wasm': jbig2Wasm, 'qcms_bg.wasm': qcmsWasm },
  standardFontDataUrl: { 'FoxitDingbats.pfb': dingbatsFont, 'FoxitSymbol.pfb': symbolFont },
}

class PdfjsFileFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const url = FILES[kind]?.[filename]
    if (!url) throw new Error(`pdf.js file not bundled: ${kind} ${filename}`)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`pdf.js file not loaded: ${filename}`)
    return new Uint8Array(await response.arrayBuffer())
  }
}

/** For getDocument: the worker asks the page for these files (from the factory above). */
export const pdfjsFileOptions = { BinaryDataFactory: PdfjsFileFactory, useWorkerFetch: false } as const
