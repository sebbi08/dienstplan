/**
 * Formatted free texts (the `text` answers of the Bögen): a small HTML subset — paragraphs (p), line breaks (br),
 * bold (strong), italic (em), underline (u) and bullet / numbered lists (ul, ol, li).
 *
 * Stored form: the canonical HTML that sanitizeRichText returns. It always starts with `<p>`, `<ul>` or `<ol` (`<ol>`
 * or `<ol start="…">`), or is '' when there is no text. Answers stored before the formatting are plain text;
 * isRichText tells them apart by that start (plain text that happened to start with such a tag is read as HTML — and
 * sanitized like any other). Plain text stays plain until it is edited in the new editor, which saves HTML; showing it
 * escapes it and keeps its line breaks.
 *
 * The sanitizer is a small tolerant tokenizer (no DOM, the same code on server and client, linear in the input): every
 * attribute goes except the first number of a numbered list (`start` on `ol`, a whole number 1–999), comments,
 * doctype and processing instructions go, script/style/iframe/svg/… go with their content, any other tag goes but
 * keeps its text; block tags (div, h1, table cells …) end the paragraph. The result is rebuilt from a document model
 * (paragraphs of marked text runs, lists of items), so it is always well-formed and canonical: b/i become strong/em,
 * marks open in the order strong > em > u (an open mark stays open across runs), white space collapses (non-breaking
 * spaces stay), empty leading/trailing paragraphs and empty list items are dropped, `start="1"` is left out.
 * Sanitizing is idempotent, so equal content gives equal strings.
 */

const MARK_STRONG = 1
const MARK_EM = 2
const MARK_U = 4
const MARK_ORDER: readonly [number, string][] = [[MARK_STRONG, 'strong'], [MARK_EM, 'em'], [MARK_U, 'u']]
const MARK_TAGS: Record<string, number> = { strong: MARK_STRONG, b: MARK_STRONG, em: MARK_EM, i: MARK_EM, u: MARK_U }

/** Lists nest at most this deep (deeper ones continue the list they are in). */
const MAX_LIST_DEPTH = 10
/** At most this many open elements are tracked; deeper start tags are ignored (their text stays). */
const MAX_OPEN_ELEMENTS = 256

/** Dropped with everything inside (up to their first end tag). */
const DROPPED = new Set([
  'script', 'style', 'template', 'noscript', 'iframe', 'object', 'svg', 'math', 'head', 'title', 'textarea', 'select',
  'xml', 'noembed', 'noframes', 'frameset',
])
const VOID = new Set([
  'br', 'hr', 'img', 'input', 'meta', 'link', 'wbr', 'col', 'area', 'base', 'embed', 'param', 'source', 'track', 'keygen',
])
/** Tags that end the paragraph (at their start and end) but are not kept. */
const BOUNDARY = new Set([
  'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'address', 'article', 'aside', 'footer', 'header',
  'section', 'main', 'nav', 'figure', 'figcaption', 'table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'dl',
  'dt', 'dd', 'hr', 'center', 'details', 'summary', 'form', 'fieldset', 'legend', 'body', 'html',
])

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', shy: '­', ndash: '–', mdash: '—', hellip: '…',
  laquo: '«', raquo: '»', bdquo: '„', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', sbquo: '‚', euro: '€', bull: '•',
  middot: '·', deg: '°', para: '¶', sect: '§', times: '×', divide: '÷', copy: '©', reg: '®', trade: '™', auml: 'ä',
  ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç',
}

type Run = { text: string; marks: number } | { br: true; marks: number }
interface Para { kind: 'p'; runs: Run[] }
/** `start`: the first number of a numbered list (2–999; 1 is left out). */
interface List { kind: 'ul' | 'ol'; items: Item[]; start?: number }
interface Item { blocks: Block[] }
type Block = Para | List

type Container = { type: 'root' | 'item'; blocks: Block[] } | { type: 'list'; list: List }

const isAsciiSpace = (code: number) => code === 32 || code === 9 || code === 10 || code === 12 || code === 13
const isNameStart = (char: string | undefined) => char !== undefined && /[a-zA-Z]/.test(char)

function decodeEntities(text: string): string {
  if (!text.includes('&')) return text
  return text.replace(/&(?:#(\d{1,8})|#[xX]([0-9a-fA-F]{1,7})|([a-zA-Z][a-zA-Z0-9]{0,31}));?/g, (match, dec, hex, name) => {
    if (dec !== undefined || hex !== undefined) {
      const code = dec !== undefined ? Number.parseInt(dec, 10) : Number.parseInt(hex, 16)
      if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '�'
      return String.fromCodePoint(code)
    }
    // A named entity needs its semicolon; unknown ones stay as typed.
    return match.endsWith(';') && Object.hasOwn(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name]! : match
  })
}

/** Control characters other than tab and line breaks never belong in a text. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000e-\u001f\u007f]/g

const escapeText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

class Builder {
  readonly root: { type: 'root'; blocks: Block[] } = { type: 'root', blocks: [] }
  ctx: Container[] = [this.root]
  para: Para | null = null
  /** Whether the open paragraph's last text ends with a space (only read while its last run is text). */
  tailSpace = false
  strong = 0
  em = 0
  u = 0

  get marks(): number {
    return (this.strong > 0 ? MARK_STRONG : 0) | (this.em > 0 ? MARK_EM : 0) | (this.u > 0 ? MARK_U : 0)
  }

  get listDepth(): number {
    return this.ctx.filter(entry => entry.type === 'list').length
  }

  /** The container blocks go into; text right inside a list gets an item of its own. */
  blockContainer(): { blocks: Block[] } {
    const top = this.ctx.at(-1)!
    if (top.type !== 'list') return top
    const item: Item = { blocks: [] }
    top.list.items.push(item)
    this.ctx.push({ type: 'item', blocks: item.blocks })
    return item
  }

  openPara(): Para {
    const para: Para = { kind: 'p', runs: [] }
    this.blockContainer().blocks.push(para)
    this.para = para
    return para
  }

  closePara(): void {
    if (this.para) trimEnd(this.para)
    this.para = null
  }

  addText(raw: string): void {
    let text = raw.replace(CONTROL, '').replace(/[ \t\n\r\f]+/g, ' ')
    if (text === '' || (text === ' ' && !this.para)) return
    const last = this.para?.runs.at(-1)
    // The flag, not the run's text: asking the growing text for its end would flatten it each time (quadratic).
    if (!last || 'br' in last || this.tailSpace) text = text.replace(/^ /, '')
    if (text === '') return
    const para = this.para ?? this.openPara()
    const marks = this.marks
    const tail = para.runs.at(-1)
    if (tail && !('br' in tail) && tail.marks === marks) tail.text += text
    else para.runs.push({ text, marks })
    this.tailSpace = text.endsWith(' ')
  }

  addBreak(): void {
    const para = this.para ?? this.openPara()
    trimEnd(para)
    para.runs.push({ br: true, marks: this.marks })
  }

  startList(kind: 'ul' | 'ol', start = 1): boolean {
    this.closePara()
    if (this.listDepth >= MAX_LIST_DEPTH) return false
    const top = this.ctx.at(-1)!
    let container: { blocks: Block[] }
    if (top.type === 'list') {
      // A list right inside a list belongs to the item before it.
      const previous = top.list.items.at(-1)
      if (previous) {
        this.ctx.push({ type: 'item', blocks: previous.blocks })
        container = previous
      }
      else {
        container = this.blockContainer()
      }
    }
    else {
      container = top
    }
    const list: List = kind === 'ol' && start !== 1 ? { kind, items: [], start } : { kind, items: [] }
    container.blocks.push(list)
    this.ctx.push({ type: 'list', list })
    return true
  }

  /**
   * Starts a list item (a loose one gets a list of its own); answers the context length its end goes back to: its
   * list, or, for a loose item, the container before the list made for it.
   */
  startItem(): number {
    this.closePara()
    // An open item ends where the next one starts.
    if (this.ctx.at(-1)!.type === 'item') this.ctx.pop()
    const top = this.ctx.at(-1)!
    const back = this.ctx.length
    let list: List
    if (top.type === 'list') {
      list = top.list
    }
    else {
      list = { kind: 'ul', items: [] }
      top.blocks.push(list)
      this.ctx.push({ type: 'list', list })
    }
    const item: Item = { blocks: [] }
    list.items.push(item)
    this.ctx.push({ type: 'item', blocks: item.blocks })
    return back
  }

  truncate(length: number): void {
    this.closePara()
    if (this.ctx.length > length) this.ctx.length = Math.max(1, length)
  }
}

/** Drops trailing spaces (and runs left empty by that) at the end of a paragraph. */
function trimEnd(para: Para): void {
  for (;;) {
    const last = para.runs.at(-1)
    if (!last || 'br' in last) return
    const text = last.text.replace(/ +$/, '')
    if (text === last.text) return
    if (text === '') para.runs.pop()
    else last.text = text
  }
}

interface OpenElement {
  name: string
  /** What closing it undoes. */
  mark?: 'strong' | 'em' | 'u'
  structural?: boolean
  ctxLength?: number
}

const COMMENT_END = /--!?>/g
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

/**
 * The first number of a numbered list from the attribute text of its `ol` — `start` is the only attribute ever kept:
 * a whole number 1–999 (digits only, spaces around allowed), anything else counts as 1. The first `start` counts, as
 * in browsers.
 */
function listStart(attributes: string): number {
  ATTRIBUTE.lastIndex = 0
  for (let match = ATTRIBUTE.exec(attributes); match; match = ATTRIBUTE.exec(attributes)) {
    if (match[1]!.toLowerCase() !== 'start') continue
    const value = (match[2] ?? match[3] ?? match[4] ?? '').trim()
    return /^\d{1,3}$/.test(value) && Number(value) >= 1 ? Number(value) : 1
  }
  return 1
}

/** Index of the next `>` outside quoted attribute values, from `from` on; -1 when the tag never ends. */
function tagEnd(html: string, from: number): number {
  let quote = ''
  for (let i = from; i < html.length; i++) {
    const char = html[i]!
    if (quote) {
      if (char === quote) quote = ''
    }
    else if (char === '"' || char === '\'') {
      // Quotes only open a value right after `=` (possibly with spaces); elsewhere they are junk.
      let j = i - 1
      while (j >= from && isAsciiSpace(html.charCodeAt(j))) j--
      if (html[j] === '=') quote = char
    }
    else if (char === '>') {
      return i
    }
  }
  return -1
}

function parse(html: string): Block[] {
  const b = new Builder()
  const open: OpenElement[] = []

  const closeElement = (entry: OpenElement) => {
    if (entry.mark) b[entry.mark] = Math.max(0, b[entry.mark] - 1)
    if (entry.structural) {
      if (entry.ctxLength !== undefined) b.truncate(entry.ctxLength)
      else b.closePara()
    }
  }

  const startTag = (name: string, selfClosing: boolean, start: number) => {
    if (name === 'br') return b.addBreak()
    if (BOUNDARY.has(name)) b.closePara()
    if (VOID.has(name) || selfClosing) return
    if (open.length >= MAX_OPEN_ELEMENTS) return
    const entry: OpenElement = { name }
    const mark = MARK_TAGS[name]
    if (mark === MARK_STRONG) entry.mark = 'strong'
    else if (mark === MARK_EM) entry.mark = 'em'
    else if (mark === MARK_U) entry.mark = 'u'
    if (entry.mark) b[entry.mark]++
    if (name === 'p') {
      b.closePara()
      b.openPara()
      entry.structural = true
    }
    else if (name === 'ul' || name === 'ol') {
      const length = b.ctx.length
      if (b.startList(name, start)) {
        entry.structural = true
        entry.ctxLength = length
      }
    }
    else if (name === 'li') {
      entry.ctxLength = b.startItem()
      entry.structural = true
    }
    else if (BOUNDARY.has(name)) {
      entry.structural = true
    }
    open.push(entry)
  }

  const endTag = (name: string) => {
    if (BOUNDARY.has(name)) b.closePara()
    let index = open.length - 1
    while (index >= 0 && open[index]!.name !== name) index--
    if (index < 0) return
    while (open.length > index) closeElement(open.pop()!)
  }

  let i = 0
  const length = html.length
  while (i < length) {
    const lt = html.indexOf('<', i)
    if (lt < 0) {
      b.addText(decodeEntities(html.slice(i)))
      break
    }
    if (lt > i) b.addText(decodeEntities(html.slice(i, lt)))
    i = lt
    const next = html[i + 1]
    if (html.startsWith('<!--', i)) {
      // As in browsers: `<!-->` and `<!--->` are empty comments; a comment ends at `-->` or `--!>` (else at the end).
      if (html[i + 4] === '>') {
        i += 5
      }
      else if (html.startsWith('->', i + 4)) {
        i += 6
      }
      else {
        COMMENT_END.lastIndex = i + 4
        const found = COMMENT_END.exec(html)
        i = found ? found.index + found[0].length : length
      }
    }
    else if (next === '!' || next === '?') {
      const end = html.indexOf('>', i + 2)
      i = end < 0 ? length : end + 1
    }
    else if (next === '/') {
      if (!isNameStart(html[i + 2])) {
        // `</>` and `</ …>`: nothing.
        const end = html.indexOf('>', i + 2)
        i = end < 0 ? length : end + 1
        continue
      }
      const match = /^[a-zA-Z][a-zA-Z0-9:_-]*/.exec(html.slice(i + 2, i + 66))!
      const end = html.indexOf('>', i + 2)
      if (end < 0) break
      endTag(match[0].toLowerCase())
      i = end + 1
    }
    else if (isNameStart(next)) {
      const match = /^[a-zA-Z][a-zA-Z0-9:_-]*/.exec(html.slice(i + 1, i + 65))!
      const name = match[0].toLowerCase()
      const attributesFrom = i + 1 + match[0].length
      const end = tagEnd(html, attributesFrom)
      // An unfinished tag at the end is dropped with the rest.
      if (end < 0) break
      const selfClosing = html[end - 1] === '/'
      i = end + 1
      if (DROPPED.has(name)) {
        // Everything up to the first end tag of the same name goes. Searched in the input itself, case-insensitively
        // (a lower-cased copy may be longer, e.g. „İ“, and its positions would not fit the input).
        const close = new RegExp(`</${name}[\\s/>]`, 'gi')
        close.lastIndex = i
        const found = close.exec(html)
        if (!found) break
        const closeEnd = html.indexOf('>', found.index)
        i = closeEnd < 0 ? length : closeEnd + 1
        continue
      }
      startTag(name, selfClosing, name === 'ol' ? listStart(html.slice(attributesFrom, end)) : 1)
    }
    else {
      // A `<` that starts no tag is text.
      b.addText('<')
      i++
    }
  }
  b.closePara()
  return normalizeBlocks(b.root.blocks)
}

const blockIsEmpty = (block: Block) => (block.kind === 'p' ? block.runs.length === 0 : block.items.length === 0)

/** Drops empty list items and lists, and empty paragraphs at the start and end of each container. */
function normalizeBlocks(blocks: Block[]): Block[] {
  const result: Block[] = []
  for (const block of blocks) {
    if (block.kind === 'p') {
      trimEnd(block)
      result.push(block)
      continue
    }
    const items = block.items
      .map(item => ({ blocks: normalizeBlocks(item.blocks) }))
      .filter(item => item.blocks.length > 0)
    if (items.length) result.push({ ...block, items })
  }
  let start = 0
  let end = result.length
  while (start < end && blockIsEmpty(result[start]!)) start++
  while (end > start && blockIsEmpty(result[end - 1]!)) end--
  return result.slice(start, end)
}

/** The runs of a paragraph as inline HTML: marks opened in the order strong > em > u, kept open across runs. */
function serializeRuns(runs: Run[]): string {
  let html = ''
  const open: [number, string][] = []
  for (const run of runs) {
    let keep = 0
    while (keep < open.length && (run.marks & open[keep]![0])) keep++
    while (open.length > keep) html += `</${open.pop()![1]}>`
    for (const mark of MARK_ORDER) {
      if ((run.marks & mark[0]) && !open.some(entry => entry[0] === mark[0])) {
        html += `<${mark[1]}>`
        open.push(mark)
      }
    }
    html += 'br' in run ? '<br>' : escapeText(run.text)
  }
  while (open.length) html += `</${open.pop()![1]}>`
  return html
}

function serializeBlocks(blocks: Block[]): string {
  return blocks.map(block => (block.kind === 'p'
    ? `<p>${serializeRuns(block.runs)}</p>`
    : `<${block.kind}${block.start ? ` start="${block.start}"` : ''}>${block.items.map(item => `<li>${serializeBlocks(item.blocks)}</li>`).join('')}</${block.kind}>`)).join('')
}

/** The canonical, safe HTML of any input ('' when it holds no text). */
export function sanitizeRichText(html: string): string {
  return serializeBlocks(parse(html))
}

/** Whether a stored text answer is HTML (else it is plain text from before the formatting). */
export const isRichText = (value: string): boolean => /^<(?:p|ul|ol)[\s>]/i.test(value)

/** Plain text as canonical HTML: escaped, one paragraph per line (an empty line is an empty paragraph). */
export function plainTextToRichText(text: string): string {
  return sanitizeRichText(text.split(/\r\n|\r|\n/).map(line => `<p>${escapeText(line)}</p>`).join(''))
}

/** Any stored text answer (plain or HTML) as canonical HTML, e.g. to start the editor with. */
export const richTextFromAnswer = (value: string): string =>
  (isRichText(value) ? sanitizeRichText(value) : plainTextToRichText(value))

/** The safe HTML to show for a stored text answer (sanitized again on every output). */
export const richTextHtml = richTextFromAnswer

/** Whether two text answers hold the same content (plain text counts as its paragraphs). */
export const sameTextAnswer = (a: string, b: string): boolean => a === b || richTextFromAnswer(a) === richTextFromAnswer(b)

function paragraphsOf(blocks: Block[], into: Para[] = []): Para[] {
  for (const block of blocks) {
    if (block.kind === 'p') into.push(block)
    else for (const item of block.items) paragraphsOf(item.blocks, into)
  }
  return into
}

/**
 * The length of formatted text as the limit counts it: its characters, one per line break and one between two
 * paragraphs (list items included) — like the line breaks of a plain text.
 */
export function richTextLength(html: string): number {
  const paragraphs = paragraphsOf(parse(html))
  let length = Math.max(0, paragraphs.length - 1)
  for (const para of paragraphs) for (const run of para.runs) length += 'br' in run ? 1 : run.text.length
  return length
}

/** The length of a stored text answer as its limit counts it (plain text: its characters). */
export const textAnswerLength = (value: string): number => (isRichText(value) ? richTextLength(value) : value.length)

interface Line { prefix: string; runs: Run[] }

/** The text as lines: paragraphs, line breaks, and list items with „• “ / „1. “ (nested ones indented). */
function linesOf(blocks: Block[], indent = '', lines: Line[] = []): Line[] {
  for (const block of blocks) {
    if (block.kind === 'p') {
      let runs: Run[] = []
      for (const run of block.runs) {
        if ('br' in run) {
          lines.push({ prefix: indent, runs })
          runs = []
        }
        else {
          runs.push(run)
        }
      }
      lines.push({ prefix: indent, runs })
      continue
    }
    block.items.forEach((item, index) => {
      const marker = block.kind === 'ul' ? '• ' : `${(block.start ?? 1) + index}. `
      const first = lines.length
      linesOf(item.blocks, indent + ' '.repeat(marker.length), lines)
      if (lines[first]) lines[first] = { ...lines[first], prefix: indent + marker }
    })
  }
  return lines
}

/** A stored text answer as plain text (lists as lines with bullets), e.g. for blank checks and single-line fields. */
export function richTextToPlain(value: string): string {
  if (!isRichText(value)) return value
  return linesOf(parse(value)).map(line => line.prefix + line.runs.map(run => ('br' in run ? '' : run.text)).join('')).join('\n')
}

/**
 * A stored text answer as inline HTML for fixed boxes (the U 1000): bold, italic and underline stay, paragraphs and
 * list items become lines (`<br>`) with „• “ / „1. “ in front.
 */
export function richTextInlineHtml(value: string): string {
  if (!isRichText(value)) return value.split(/\r\n|\r|\n/).map(escapeText).join('<br>')
  return linesOf(parse(value))
    // Leading spaces (the indent of nested items and continued lines) as non-breaking ones, so HTML keeps them.
    .map(line => line.prefix.replace(/^ +/, spaces => ' '.repeat(spaces.length)) + serializeRuns(line.runs))
    .join('<br>')
}
