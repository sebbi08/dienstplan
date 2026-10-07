import { chromium, type Browser } from 'playwright-core'

/** Print views that may be turned into a PDF (plan print and the admin print pages). */
export const PDF_PATH = /^\/(?:admin\/)?print\/[\w\-/]+$/

/** The app as the headless browser reaches it from inside the server (no detour over the public domain). */
function internalOrigin(): string {
  return process.env.PDF_ORIGIN || `http://127.0.0.1:${process.env.PORT || 3000}`
}

let browser: Promise<Browser> | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
/** The browser is started on first use and closed again after a quiet minute, so it costs memory only briefly. */
const IDLE_MS = 60_000

function useBrowser(): Promise<Browser> {
  if (idleTimer) clearTimeout(idleTimer)
  // Docker gives /dev/shm only 64 MB; Chromium then uses /tmp instead.
  browser ??= chromium.launch({ args: ['--disable-dev-shm-usage'] }).catch((error) => {
    browser = null
    throw error
  })
  return browser
}

function releaseLater(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    const closing = browser
    browser = null
    closing?.then(open => open.close()).catch(() => undefined)
  }, IDLE_MS)
}

/**
 * Renders one of the app's print pages as a PDF, signed in as the requesting user (their cookies are passed on),
 * so the page shows exactly what that user may see and print.
 */
export async function renderPdf(path: string, cookieHeader: string | undefined): Promise<Buffer> {
  const origin = internalOrigin()
  const context = await (await useBrowser()).newContext()
  try {
    const cookies = (cookieHeader ?? '').split(';').map(part => part.trim()).filter(Boolean).map((part) => {
      const index = part.indexOf('=')
      return { name: part.slice(0, index), value: part.slice(index + 1), url: origin }
    }).filter(cookie => cookie.name)
    if (cookies.length) await context.addCookies(cookies)
    const page = await context.newPage()
    const response = await page.goto(`${origin}${path}`, { waitUntil: 'networkidle', timeout: 30_000 })
    if (!response || !response.ok()) throw createError({ statusCode: 502, statusMessage: 'pdf_page_failed', data: { code: 'pdf_page_failed' } })
    // Someone who may not see the page is redirected (e.g. to the login or the own plan): no PDF of another page.
    if (new URL(page.url()).pathname !== path) throw createError({ statusCode: 403, statusMessage: 'forbidden', data: { code: 'forbidden' } })
    await page.emulateMedia({ media: 'print' })
    return await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true })
  }
  finally {
    await context.close().catch(() => undefined)
    releaseLater()
  }
}
