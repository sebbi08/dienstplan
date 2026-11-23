import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PdfTextItem } from '../../shared/domain/schoolDistricts'
import { ServiceError } from './errors'

/**
 * The text layer of an uploaded PDF (an untrusted file), read with pdf.js (the legacy build the app already ships) in a
 * **separate Node process**, so whatever the file does to memory or CPU never reaches the server process:
 * - Before pdf.js sees the file, every Flate stream is inflated with a size cap against a total budget (`inflateMb`):
 *   a decompression bomb is refused cheaply ('inflate').
 * - pdf.js then runs in a worker thread inside that process (fonts, scripting and XFA off; only text items and their
 *   positions are read; pages, items and characters capped). The process's main thread only watches: it reports its
 *   resident memory (RSS, which also counts the typed arrays pdf.js decodes into, unlike a heap limit) to the server
 *   every 100 ms.
 * - The server kills the process when it reports more than `rssMb`, stops reporting for `stallMs`, or takes longer
 *   than `timeoutMs`; the JS heap of the process is capped as well (`heapMb`).
 * - One PDF at a time: a second upload meanwhile gets 429 pdf_busy.
 * The process runs the code below with `node -e`, so the build needs no extra file for it (pdf.js itself is traced into
 * the build by nuxt.config.ts). A crash of the process only rejects the upload.
 */
export interface PdfTextLimits {
  timeoutMs: number
  maxPages: number
  maxItems: number
  /** Characters of all text items together. */
  maxChars: number
  heapMb: number
  /** Resident memory of the reading process. */
  rssMb: number
  /** Inflated size of all Flate streams together (checked before pdf.js). */
  inflateMb: number
  /** The process reports its memory every 100 ms; silence for this long kills it. */
  stallMs: number
}

export const PDF_TEXT_LIMITS: PdfTextLimits = {
  timeoutMs: 20_000, maxPages: 300, maxItems: 300_000, maxChars: 5_000_000, heapMb: 256, rssMb: 512, inflateMb: 128, stallMs: 5_000,
}

/** The pdf.js worker thread: CommonJS, loads pdf.js by URL. */
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads')
;(async () => {
  const { pdfUrl, workerUrl, data, maxPages, maxItems, maxChars } = workerData
  const pdfjs = await import(pdfUrl)
  globalThis.pdfjsWorker = await import(workerUrl)
  const task = pdfjs.getDocument({
    data, isEvalSupported: false, enableXfa: false, disableFontFace: true, useSystemFonts: false, verbosity: 0,
  })
  const document = await task.promise
  if (document.numPages > maxPages) return parentPort.postMessage({ error: 'pages' })
  const pages = []
  let count = 0
  let chars = 0
  for (let number = 1; number <= document.numPages; number++) {
    const content = await (await document.getPage(number)).getTextContent()
    const items = []
    for (const item of content.items) {
      if (typeof item.str !== 'string') continue
      if (++count > maxItems) return parentPort.postMessage({ error: 'items' })
      const str = item.str.slice(0, 500)
      chars += str.length
      if (chars > maxChars) return parentPort.postMessage({ error: 'items' })
      items.push({ str, x: Number(item.transform[4]) || 0, y: Number(item.transform[5]) || 0, w: Number(item.width) || 0 })
    }
    pages.push(items)
  }
  parentPort.postMessage({ pages })
})().catch(() => parentPort.postMessage({ error: 'unreadable' }))
`

/** The reading process (`node -e`): pre-check, then pdf.js in a worker thread, while the main thread reports its memory. */
const CHILD_SOURCE = `
const { Worker } = require('node:worker_threads')
const zlib = require('node:zlib')
const WORKER_SOURCE = ${JSON.stringify(WORKER_SOURCE)}
const send = (message, then) => { try { process.send(message, then) } catch { process.exit(0) } }
process.on('disconnect', () => process.exit(0))
const report = setInterval(() => send({ rss: process.memoryUsage.rss() }), 100)
// Every Flate stream inflated with a cap, against one budget; forward-only searches keep it linear in the file size.
function precheck(buf, budget) {
  let total = 0
  let pos = 0
  let streams = 0
  for (;;) {
    const s = buf.indexOf('stream', pos, 'latin1')
    if (s < 0) return null
    if (s >= 3 && buf.toString('latin1', s - 3, s) === 'end') { pos = s + 6; continue }
    let start = s + 6
    if (buf[start] === 13) start++
    if (buf[start] === 10) start++
    const end = buf.indexOf('endstream', start, 'latin1')
    if (end < 0) return null
    const dictionary = buf.toString('latin1', Math.max(pos, s - 2048), s)
    pos = end + 9
    if (!/FlateDecode|\\/Fl\\b/.test(dictionary)) continue
    if (++streams > 10000) return 'streams'
    try {
      total += zlib.inflateSync(buf.subarray(start, end), { maxOutputLength: budget - total + 1, finishFlush: zlib.constants.Z_SYNC_FLUSH }).length
    }
    catch (error) {
      if (error && error.code === 'ERR_BUFFER_TOO_LARGE') return 'inflate'
      continue
    }
    if (total > budget) return 'inflate'
  }
}
process.once('message', (job) => {
  const data = Buffer.from(job.data.buffer, job.data.byteOffset, job.data.byteLength)
  let reason = null
  try { reason = precheck(data, job.inflateMb * 1024 * 1024) } catch { reason = 'unreadable' }
  if (reason) return send({ error: reason }, () => process.exit(0))
  send({ rss: process.memoryUsage.rss() })
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: { pdfUrl: job.pdfUrl, workerUrl: job.workerUrl, data: new Uint8Array(data), maxPages: job.maxPages, maxItems: job.maxItems, maxChars: job.maxChars },
    resourceLimits: { maxOldGenerationSizeMb: job.heapMb, maxYoungGenerationSizeMb: 32 },
    stdout: true,
    stderr: true,
  })
  worker.stdout.resume()
  worker.stderr.resume()
  worker.once('message', (message) => { clearInterval(report); send(message, () => process.exit(0)) })
  worker.once('error', () => send({ error: 'crashed' }, () => process.exit(0)))
  worker.once('exit', () => send({ error: 'exit' }, () => process.exit(0)))
})
`

let urls: { pdfUrl: string; workerUrl: string } | null = null
let reportedMissing = false

/**
 * The file URLs of pdf.js and its worker module (nuxt.config.ts traces both into the build). Resolved from this file in
 * development and tests; the server bundle replaces import.meta.url with a placeholder, so there they are resolved from
 * the started script (.output/server/index.mjs, next to the bundle's node_modules), then from the working directory.
 */
function pdfjsUrls(): { pdfUrl: string; workerUrl: string } {
  if (urls) return urls
  const bases = [import.meta.url, process.argv[1], join(process.cwd(), '.output', 'server', 'index.mjs'), join(process.cwd(), 'package.json')]
    .filter((base): base is string => !!base)
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
  if (!reportedMissing) {
    reportedMissing = true
    console.error(`PDF upload: pdf.js not found (looked from ${bases.join(', ')}). Is the server started as node .output/server/index.mjs?`)
  }
  throw new ServiceError(422, 'pdf_unreadable', { reason: 'pdfjs_missing' })
}

const MB = 1024 * 1024
let running = false

/** One reading process: resolves with the pages, rejects with 422 pdf_unreadable (details.reason) or pdf_no_text. */
function readInChild(data: Uint8Array, limits: PdfTextLimits): Promise<PdfTextItem[][]> {
  const files = pdfjsUrls()
  return new Promise((resolve, reject) => {
    let settled = false
    let child: ChildProcess
    const fail = (reason: string) => new ServiceError(422, 'pdf_unreadable', { reason })
    const finish = (error: ServiceError | null, pages?: PdfTextItem[][]) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearInterval(stallCheck)
      if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      if (error) reject(error)
      else if (!pages!.some(page => page.some(item => item.str.trim() !== ''))) reject(new ServiceError(422, 'pdf_no_text'))
      else resolve(pages!)
    }
    let lastReport = Date.now()
    const timer = setTimeout(() => finish(fail('time')), limits.timeoutMs)
    const stallCheck = setInterval(() => {
      if (Date.now() - lastReport > limits.stallMs) finish(fail('stalled'))
    }, 250)
    try {
      child = spawn(process.execPath, [`--max-old-space-size=${limits.heapMb}`, '-e', CHILD_SOURCE], {
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'advanced', windowsHide: true,
        // The parent's NODE_OPTIONS (an inspector, a loader) stay out of the reading process.
        env: { ...process.env, NODE_OPTIONS: '' },
      })
    }
    catch {
      finish(fail('spawn'))
      return
    }
    // After the kill an 'error' may still come; it must never become an uncaught exception.
    child.on('error', () => finish(fail('crashed')))
    child.once('exit', () => finish(fail('exit')))
    child.on('message', (message: { rss?: number; pages?: PdfTextItem[][]; error?: string }) => {
      if (typeof message.rss === 'number') {
        lastReport = Date.now()
        if (message.rss > limits.rssMb * MB) finish(fail('memory'))
      }
      else if (message.pages) finish(null, message.pages)
      else finish(fail(message.error ?? 'unreadable'))
    })
    child.send({
      ...files, data: new Uint8Array(data), maxPages: limits.maxPages, maxItems: limits.maxItems, maxChars: limits.maxChars,
      heapMb: limits.heapMb, inflateMb: limits.inflateMb,
    }, (error) => { if (error) finish(fail('spawn')) })
  })
}

/**
 * The text items of every page, read in a separate process (see above). 429 pdf_busy while another PDF is being read;
 * 422 pdf_unreadable when the file cannot be read or breaks a limit (details.reason: inflate, memory, time, pages,
 * items, stalled, crashed, …); 422 pdf_no_text when no page holds text (a scan).
 */
export async function pdfTextItems(data: Uint8Array, limits: PdfTextLimits = PDF_TEXT_LIMITS): Promise<PdfTextItem[][]> {
  if (running) throw new ServiceError(429, 'pdf_busy')
  running = true
  try {
    return await readInChild(data, limits)
  }
  finally {
    running = false
  }
}
