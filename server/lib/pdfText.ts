import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PdfTextItem } from '../../shared/domain/schoolDistricts'
import { ServiceError } from './errors'

/**
 * The text layer of an uploaded PDF (an untrusted file), read with pdf.js (the legacy build the app already ships) in a
 * **separate Node process**, so whatever the file does to memory or CPU never reaches the server process:
 * - The work runs in a worker thread inside that process. First every **Flate** stream is inflated (streaming, only
 *   the byte count is kept) against a total output budget (`inflateMb`) and an input budget (twice the file plus 1 MB):
 *   a decompression bomb, or deflate data chained through the whole file, is refused cheaply ('inflate'). `stream`
 *   counts only as the keyword (after a dictionary's `>>`, followed by a line end); each stream is inflated from its
 *   start to the end of its deflate data, and the search goes on right behind the keyword, so neither a fake
 *   `endstream`, a wrong `/Length` nor the word inside a string makes it skip bytes. A stream keyword without any
 *   `endstream` after it refuses the file ('structure'). Other filters (LZW, RunLength, a chain not starting with
 *   Flate, an indirect `/Filter`) are not pre-checked; the memory watch below bounds them. Then pdf.js reads the file
 *   (fonts, scripting and XFA off; only text items and their positions; pages, items and characters capped).
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
// The deflate data starting at input[0]: how many bytes it inflates to (only counted, never kept; over \`budget\`:
// over) and how many input bytes it took (trailing bytes after its end are not read). The input given is already cut to
// what may still be read, so data that runs on through the rest of the file cannot be read twice.
function inflatedSize(input, budget) {
  return new Promise((resolve) => {
    const inflate = zlib.createInflate({ finishFlush: zlib.constants.Z_SYNC_FLUSH })
    let total = 0
    let done = false
    const finish = (over) => {
      if (done) return
      done = true
      const read = inflate.bytesWritten
      inflate.destroy()
      resolve({ out: total, read, over })
    }
    inflate.on('data', (chunk) => { total += chunk.length; if (total > budget) finish(true) })
    inflate.on('end', () => finish(false))
    inflate.on('error', () => finish(false))
    inflate.end(input)
  })
}
const isSpace = (byte) => byte === 32 || byte === 9 || byte === 10 || byte === 13 || byte === 12 || byte === 0
// Every Flate stream against one output budget and one input budget (twice the file plus 1 MB). „stream“ counts only as
// the keyword: after a dictionary's „>>“ (and white space) and followed by a line end. The search never jumps: after a
// stream it goes on right behind its keyword, so no bytes are left unchecked, whatever the lengths in the file claim.
async function precheck(buf, budget) {
  let total = 0
  let input = 2 * buf.length + 1024 * 1024
  let pos = 0
  let previous = 0
  let nextEnd = -2
  let streams = 0
  for (;;) {
    const s = buf.indexOf('stream', pos, 'latin1')
    if (s < 0) return null
    pos = s + 6
    let k = s - 1
    while (k >= 0 && isSpace(buf[k])) k--
    if (k < 1 || buf[k] !== 62 || buf[k - 1] !== 62) continue
    let start = s + 6
    if (buf[start] === 13 && buf[start + 1] === 10) start += 2
    else if (buf[start] === 10 || buf[start] === 13) start += 1
    else continue
    // A real stream keyword needs an end somewhere after it (the next one is looked up once and reused).
    if (nextEnd !== -1 && nextEnd < start) nextEnd = buf.indexOf('endstream', start, 'latin1')
    if (nextEnd === -1) return 'structure'
    const dictionary = buf.toString('latin1', Math.max(previous, s - 2048), s)
    previous = start
    if (!/FlateDecode|\\/Fl\\b/.test(dictionary)) continue
    if (++streams > 10000) return 'streams'
    if (input <= 0) return 'inflate'
    const result = await inflatedSize(buf.subarray(start, start + input), budget - total)
    if (result.over) return 'inflate'
    total += result.out
    input -= Math.max(result.read, 1)
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
  // The file arrives as a view into the IPC message, so it is copied once into a buffer of its own, which is then moved
  // (not cloned) to the worker; the message copy is garbage afterwards.
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
let readerPid: number | null = null

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
    readerPid = child.pid ?? null
    // After the kill an 'error' may still come; it must never become an uncaught exception.
    child.on('error', () => finish(fail('crashed')))
    // 'close' (not 'exit'): the IPC channel is drained first, so the last message is never lost to the exit.
    child.once('close', (code) => {
      finish(fail(code === MEMORY_EXIT ? 'memory' : 'exit'))
      readerPid = null
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
    // 5 s at most, a timer that keeps nothing alive and is cleared at once).
    let fallback: ReturnType<typeof setTimeout> | undefined
    await Promise.race([closed, new Promise((resolve) => {
      fallback = setTimeout(resolve, 5_000)
      fallback.unref?.()
    })])
    clearTimeout(fallback)
    running = false
  }
}

/** The process id of the reader at work, null when none is left (for tests and diagnostics). */
export const activeReaderPid = () => readerPid
