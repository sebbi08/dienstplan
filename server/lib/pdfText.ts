import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import type { PdfTextItem } from '../../shared/domain/schoolDistricts'
import { ServiceError } from './errors'

/**
 * The text layer of an uploaded PDF (an untrusted file), read with pdf.js (the legacy build the app already ships) in a
 * worker thread of its own: a file that makes pdf.js loop or eat memory never blocks the server. The worker gets a
 * wall-clock budget and a heap limit and is terminated after either; pages and text items are capped as well. Fonts,
 * scripting and XFA stay off: only the text items and their positions are read.
 */
export interface PdfTextLimits {
  timeoutMs: number
  maxPages: number
  maxItems: number
  heapMb: number
}

export const PDF_TEXT_LIMITS: PdfTextLimits = { timeoutMs: 20_000, maxPages: 300, maxItems: 300_000, heapMb: 256 }

/** The worker: CommonJS, loads pdf.js by URL (the server bundle keeps pdfjs-dist as a package of its own). */
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads')
;(async () => {
  const { pdfUrl, workerUrl, data, maxPages, maxItems } = workerData
  const pdfjs = await import(pdfUrl)
  globalThis.pdfjsWorker = await import(workerUrl)
  const task = pdfjs.getDocument({
    data, isEvalSupported: false, enableXfa: false, disableFontFace: true, useSystemFonts: false, verbosity: 0,
  })
  const document = await task.promise
  if (document.numPages > maxPages) return parentPort.postMessage({ error: 'pages' })
  const pages = []
  let count = 0
  for (let number = 1; number <= document.numPages; number++) {
    const content = await (await document.getPage(number)).getTextContent()
    const items = []
    for (const item of content.items) {
      if (typeof item.str !== 'string') continue
      if (++count > maxItems) return parentPort.postMessage({ error: 'items' })
      items.push({ str: item.str.slice(0, 500), x: Number(item.transform[4]) || 0, y: Number(item.transform[5]) || 0, w: Number(item.width) || 0 })
    }
    pages.push(items)
  }
  parentPort.postMessage({ pages })
})().catch(() => parentPort.postMessage({ error: 'unreadable' }))
`

let urls: { pdfUrl: string; workerUrl: string } | null = null

/**
 * The file URLs of pdf.js and its worker module (nuxt.config.ts traces both into the build). Resolved from this file in
 * development and tests; the server bundle replaces import.meta.url with a placeholder, so there they are resolved from
 * the started script (.output/server/index.mjs, next to the bundle's node_modules), then from the working directory.
 */
function pdfjsUrls(): { pdfUrl: string; workerUrl: string } {
  if (urls) return urls
  const bases = [import.meta.url, process.argv[1], join(process.cwd(), 'package.json')].filter((base): base is string => !!base)
  for (const base of bases) {
    try {
      const require = createRequire(base)
      urls = {
        pdfUrl: pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href,
        workerUrl: pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href,
      }
      return urls
    }
    catch {
      // Not found from there: try the next base.
    }
  }
  throw new ServiceError(422, 'pdf_unreadable', { reason: 'pdfjs_missing' })
}

/**
 * The text items of every page. 422 pdf_unreadable when pdf.js cannot read the file, runs out of time or memory, or
 * finds more pages or items than allowed; 422 pdf_no_text when no page holds text (a scan).
 */
export function pdfTextItems(data: Uint8Array, limits: PdfTextLimits = PDF_TEXT_LIMITS): Promise<PdfTextItem[][]> {
  return new Promise((resolve, reject) => {
    let settled = false
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { ...pdfjsUrls(), data: new Uint8Array(data), maxPages: limits.maxPages, maxItems: limits.maxItems },
      resourceLimits: { maxOldGenerationSizeMb: limits.heapMb, maxYoungGenerationSizeMb: 32 },
      // pdf.js warnings about the file are dropped (drained, not shown in the server log).
      stdout: true,
      stderr: true,
    })
    worker.stdout.resume()
    worker.stderr.resume()
    const finish = (error: ServiceError | null, pages?: PdfTextItem[][]) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void worker.terminate()
      if (error) reject(error)
      else if (!pages!.some(page => page.some(item => item.str.trim() !== ''))) reject(new ServiceError(422, 'pdf_no_text'))
      else resolve(pages!)
    }
    const timer = setTimeout(() => finish(new ServiceError(422, 'pdf_unreadable', { reason: 'time' })), limits.timeoutMs)
    worker.once('message', (message: { pages?: PdfTextItem[][]; error?: string }) => {
      if (message.pages) finish(null, message.pages)
      else finish(new ServiceError(422, 'pdf_unreadable', { reason: message.error ?? 'unreadable' }))
    })
    worker.once('error', () => finish(new ServiceError(422, 'pdf_unreadable', { reason: 'crashed' })))
    worker.once('exit', () => finish(new ServiceError(422, 'pdf_unreadable', { reason: 'exit' })))
  })
}
