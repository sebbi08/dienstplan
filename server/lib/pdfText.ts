import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PdfTextItem } from '../../shared/domain/schoolDistricts'
import { ServiceError } from './errors'

/**
 * The text layer of an uploaded PDF (an untrusted file), read with pdf.js (the legacy build the app already ships) in a
 * **separate Node process**, so whatever the file does to memory or CPU never reaches the server process:
 * - The work runs in a worker thread inside that process. First every Flate stream is inflated (streaming, only the
 *   byte count is kept) against a total budget (`inflateMb`): a decompression bomb is refused cheaply ('inflate'). A
 *   stream is inflated from its start to the end of its deflate data – a direct `/Length` or the keyword `endstream`
 *   only says where the next object starts, so a fake `endstream` inside the data does not shorten the check; a stream
 *   without `endstream` and without a direct length refuses the file ('structure'). Then pdf.js reads it (fonts,
 *   scripting and XFA off; only text items and their positions; pages, items and characters capped).
 * - The process's main thread does nothing but watch: every 15 ms it reads its own resident memory (RSS, which also
 *   counts the typed arrays pdf.js decodes into, unlike a heap limit) and exits at once above `rssMb`; every ~90 ms it
 *   reports to the server. The server kills it as a backstop above `rssMb`, after `stallMs` without a report or after
 *   `timeoutMs`; the JS heaps are capped as well (`heapMb`).
 * - One PDF at a time: a second upload meanwhile gets 429 pdf_busy, until the previous process has really ended.
 * The process runs the code below with `node -e` and a minimal environment, so the build needs no extra file for it
 * (pdf.js itself is traced into the build by nuxt.config.ts). A crash of the process only rejects the upload.
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
  /** The process reports its memory about every 90 ms; silence for this long kills it. */
  stallMs: number
}

/**
 * The container of the app has 1024 MB for everything (docs/BETRIEB.md „Speicher“): the server runs at about 150–300 MB,
 * so the reader gets at most 320 MB resident (heap 160 MB) and stops itself above it. The pre-check budget (96 MB of
 * inflated data) keeps a file that pdf.js would have to decode into more than that from being opened at all. The real
 * street list (8 pages) peaks at about 110 MB.
 */
export const PDF_TEXT_LIMITS: PdfTextLimits = {
  timeoutMs: 20_000, maxPages: 300, maxItems: 300_000, maxChars: 5_000_000, heapMb: 160, rssMb: 320, inflateMb: 96, stallMs: 5_000,
}

/** The exit code of a reader that stopped itself over its memory limit. */
const MEMORY_EXIT = 77

let peakRss = 0
/** The highest resident memory the reading process reported during the last read (bytes; for tests and diagnostics). */
export const lastReadPeakRss = () => peakRss

/** The worker thread: pre-check, then pdf.js (CommonJS, loads pdf.js by URL). */
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads')
const zlib = require('node:zlib')
// The size of the deflate data starting at input[0] (trailing bytes after its end are ignored), -1 above the budget;
// only the count is kept, never the inflated data.
function inflatedSize(input, budget) {
  return new Promise((resolve) => {
    const inflate = zlib.createInflate({ finishFlush: zlib.constants.Z_SYNC_FLUSH })
    let total = 0
    let done = false
    const finish = (value) => { if (!done) { done = true; inflate.destroy(); resolve(value) } }
    inflate.on('data', (chunk) => { total += chunk.length; if (total > budget) finish(-1) })
    inflate.on('end', () => finish(total))
    inflate.on('error', () => finish(total))
    inflate.end(input)
  })
}
// Every Flate stream against one budget; forward-only searches, so linear in the file size apart from the inflating.
async function precheck(buf, budget) {
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
    const dictionary = buf.toString('latin1', Math.max(pos, s - 2048), s)
    const length = /\\/Length\\s+(\\d{1,10})\\b(?!\\s+\\d+\\s+R)/.exec(dictionary)
    let next
    if (length && start + Number(length[1]) <= buf.length) next = start + Number(length[1])
    else {
      const end = buf.indexOf('endstream', start, 'latin1')
      if (end < 0) return 'structure'
      next = end
    }
    pos = next
    if (!/FlateDecode|\\/Fl\\b/.test(dictionary)) continue
    if (++streams > 10000) return 'streams'
    const size = await inflatedSize(buf.subarray(start), budget - total)
    if (size < 0) return 'inflate'
    total += size
  }
}
;(async () => {
  const { pdfUrl, workerUrl, data, maxPages, maxItems, maxChars, inflateMb } = workerData
  const reason = await precheck(Buffer.from(data.buffer, data.byteOffset, data.byteLength), inflateMb * 1024 * 1024)
  if (reason) return parentPort.postMessage({ error: reason })
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

/** The reading process (`node -e`): its main thread watches its memory, the worker thread does the reading. */
const CHILD_SOURCE = `
const { Worker } = require('node:worker_threads')
const WORKER_SOURCE = ${JSON.stringify(WORKER_SOURCE)}
const send = (message, then) => { try { process.send(message, then) } catch { process.exit(0) } }
process.on('disconnect', () => process.exit(0))
let limit = Infinity
let tick = 0
const watch = setInterval(() => {
  const rss = process.memoryUsage.rss()
  if (rss > limit) process.exit(${MEMORY_EXIT})
  if (++tick % 6 === 0) send({ rss })
}, 15)
process.once('message', (job) => {
  limit = job.rssMb * 1024 * 1024
  // The file goes to the worker without another copy (its own buffer is moved, not cloned).
  let data = job.data
  if (data.byteOffset !== 0 || data.byteLength !== data.buffer.byteLength) data = new Uint8Array(data)
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: { pdfUrl: job.pdfUrl, workerUrl: job.workerUrl, data, maxPages: job.maxPages, maxItems: job.maxItems, maxChars: job.maxChars, inflateMb: job.inflateMb },
    transferList: [data.buffer],
    resourceLimits: { maxOldGenerationSizeMb: job.heapMb, maxYoungGenerationSizeMb: 32 },
    stdout: true,
    stderr: true,
  })
  worker.stdout.resume()
  worker.stderr.resume()
  worker.once('message', (message) => { clearInterval(watch); send({ rss: process.memoryUsage.rss() }); send(message, () => process.exit(0)) })
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

/** What the reading process gets of the server's environment: nothing secret, only what Node needs to start. */
function readerEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_OPTIONS: '' }
  for (const name of ['PATH', 'Path', 'TZ', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP']) {
    if (process.env[name] !== undefined) env[name] = process.env[name]
  }
  return env
}

const MB = 1024 * 1024
let running = false

/**
 * One reading process: `pages` resolves with the pages or rejects with 422 pdf_unreadable (details.reason) or
 * pdf_no_text; `closed` resolves once the process has ended (also after a kill).
 */
function readInChild(data: Uint8Array, limits: PdfTextLimits): { pages: Promise<PdfTextItem[][]>; closed: Promise<void> } {
  const files = pdfjsUrls()
  let markClosed: () => void = () => {}
  const closed = new Promise<void>((resolve) => { markClosed = resolve })
  const pages = new Promise<PdfTextItem[][]>((resolve, reject) => {
    let settled = false
    let child: ChildProcess | undefined
    const fail = (reason: string) => new ServiceError(422, 'pdf_unreadable', { reason })
    const finish = (error: ServiceError | null, result?: PdfTextItem[][]) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearInterval(stallCheck)
      if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      if (error) reject(error)
      else if (!result!.some(page => page.some(item => item.str.trim() !== ''))) reject(new ServiceError(422, 'pdf_no_text'))
      else resolve(result!)
    }
    let lastReport = Date.now()
    const timer = setTimeout(() => finish(fail('time')), limits.timeoutMs)
    const stallCheck = setInterval(() => {
      if (Date.now() - lastReport > limits.stallMs) finish(fail('stalled'))
    }, 250)
    try {
      child = spawn(process.execPath, [`--max-old-space-size=${limits.heapMb}`, '-e', CHILD_SOURCE], {
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'advanced', windowsHide: true, env: readerEnvironment(),
      })
    }
    catch {
      finish(fail('spawn'))
      markClosed()
      return
    }
    // After the kill an 'error' may still come; it must never become an uncaught exception.
    child.on('error', () => finish(fail('crashed')))
    // 'close' (not 'exit'): the IPC channel is drained first, so the last message is never lost to the exit.
    child.once('close', (code) => {
      finish(fail(code === MEMORY_EXIT ? 'memory' : 'exit'))
      markClosed()
    })
    child.on('message', (message: { rss?: number; pages?: PdfTextItem[][]; error?: string }) => {
      if (typeof message.rss === 'number') {
        lastReport = Date.now()
        peakRss = Math.max(peakRss, message.rss)
        if (message.rss > limits.rssMb * MB) finish(fail('memory'))
      }
      else if (message.pages) finish(null, message.pages)
      else finish(fail(message.error ?? 'unreadable'))
    })
    // The buffer is serialised once into the process (no copy here first).
    child.send({
      ...files, data, maxPages: limits.maxPages, maxItems: limits.maxItems, maxChars: limits.maxChars,
      heapMb: limits.heapMb, rssMb: limits.rssMb, inflateMb: limits.inflateMb,
    }, (error) => { if (error) finish(fail('spawn')) })
  })
  return { pages, closed }
}

/**
 * The text items of every page, read in a separate process (see above). 429 pdf_busy while another PDF is being read
 * (until its process has ended); 422 pdf_unreadable when the file cannot be read or breaks a limit (details.reason:
 * inflate, structure, memory, time, pages, items, stalled, crashed, …); 422 pdf_no_text when no page holds text (a scan).
 */
export async function pdfTextItems(data: Uint8Array, limits: PdfTextLimits = PDF_TEXT_LIMITS): Promise<PdfTextItem[][]> {
  if (running) throw new ServiceError(429, 'pdf_busy')
  running = true
  peakRss = 0
  let closed: Promise<void> = Promise.resolve()
  try {
    const read = readInChild(data, limits)
    closed = read.closed
    return await read.pages
  }
  finally {
    // The next reader starts only once this process is gone (it closes within about 100 ms of its answer or kill;
    // 5 s at most).
    await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 5_000))])
    running = false
  }
}
