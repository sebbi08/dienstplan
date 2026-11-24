import {
  emptyAnswer, RATING_LEGEND, type AnswerableItem, type FormAnswer, type FormAnswers, type FormContent, type FormItem,
  type MilestoneAnswer, type RatingAnswer, type RatingValue,
} from './forms'
import { richTextToPlain, sameTextAnswer } from './richText'

/**
 * The history of a child form's answers (Beobachtungs- und Entwicklungsbögen): which items a save changed, who changed
 * an item last, what differs between a stored state and the current one, and two forms of the same template side by
 * side with the trend of ratings and milestones. Pure functions, the same on server and client.
 *
 * An answer missing from the stored answers counts as the item's empty answer (`emptyAnswer`), so saving an untouched
 * form (the panel sends every item) changes nothing; a plain text and the same text formatted count as equal.
 */

const answerable = (item: FormItem): item is AnswerableItem => item.kind !== 'note'

/** The answerable items of a content, in their order. */
export function answerableItems(content: FormContent): AnswerableItem[] {
  return content.sections.flatMap(section => section.items.filter(answerable))
}

/** The stored answer of the item, or its empty answer. */
export function answerOf(item: AnswerableItem, answers: FormAnswers): FormAnswer {
  const stored = answers[item.id]
  return stored === undefined ? emptyAnswer(item) : stored as FormAnswer
}

const textOf = (value: FormAnswer): string => (typeof value === 'string' ? value : '')
const choicesOf = (value: FormAnswer): string[] => (Array.isArray(value) ? value : [])
const ratingOf = (value: FormAnswer): RatingAnswer => {
  const rating = value as RatingAnswer | null
  return { value: rating?.value ?? null, remark: rating?.remark ?? '' }
}
const milestoneOf = (value: FormAnswer): MilestoneAnswer => {
  const milestone = value as MilestoneAnswer | null
  return { reached: milestone?.reached === true, remark: milestone?.remark ?? '' }
}
const dateOf = (value: FormAnswer): string | null => (typeof value === 'string' && value !== '' ? value : null)

/** Whether two answers of the item hold the same (choices in any order). */
export function sameAnswer(item: AnswerableItem, a: FormAnswer, b: FormAnswer): boolean {
  switch (item.kind) {
    case 'text': return sameTextAnswer(textOf(a), textOf(b))
    case 'choices': {
      const left = new Set(choicesOf(a))
      const right = choicesOf(b)
      return left.size === new Set(right).size && right.every(id => left.has(id))
    }
    case 'rating': {
      const left = ratingOf(a)
      const right = ratingOf(b)
      return left.value === right.value && left.remark === right.remark
    }
    case 'milestone': {
      const left = milestoneOf(a)
      const right = milestoneOf(b)
      return left.reached === right.reached && left.remark === right.remark
    }
    case 'date': return dateOf(a) === dateOf(b)
  }
}

/** Whether the answer says nothing (a text of white space only, nothing ticked, no rating and no remark …). */
export function isEmptyAnswer(item: AnswerableItem, value: FormAnswer): boolean {
  switch (item.kind) {
    case 'text': return richTextToPlain(textOf(value)).trim() === ''
    case 'choices': return choicesOf(value).length === 0
    case 'rating': {
      const rating = ratingOf(value)
      return rating.value === null && rating.remark.trim() === ''
    }
    case 'milestone': {
      const milestone = milestoneOf(value)
      return !milestone.reached && milestone.remark.trim() === ''
    }
    case 'date': return dateOf(value) === null
  }
}

/** The ids of the items whose answer differs between `before` and `after`, in the content's order. */
export function changedItemIds(content: FormContent, before: FormAnswers, after: FormAnswers): string[] {
  return answerableItems(content)
    .filter(item => !sameAnswer(item, answerOf(item, before), answerOf(item, after)))
    .map(item => item.id)
}

/** A stored revision as far as the per-item info needs it. */
export interface RevisionStamp {
  savedAt: string
  savedBy: string
  changedItemIds: readonly string[]
}

/** When and by whom an item was changed last. */
export interface ItemChange { changedAt: string; changedBy: string }

/**
 * The last change of every item that was ever changed, from the revisions newest first (the first revision naming an
 * item wins). The revision written for the state before the history began names no item: who wrote those answers is
 * not known.
 */
export function itemChanges(revisionsNewestFirst: readonly RevisionStamp[]): Record<string, ItemChange> {
  const result: Record<string, ItemChange> = {}
  for (const revision of revisionsNewestFirst) {
    for (const id of revision.changedItemIds) {
      if (!Object.hasOwn(result, id)) result[id] = { changedAt: revision.savedAt, changedBy: revision.savedBy }
    }
  }
  return result
}

/**
 * The items changed after the viewer last opened the form (`seenAt`, ISO time); none when they never opened it before
 * (everything would be new).
 */
export function changedSince(changes: Record<string, ItemChange>, seenAt: string | null): string[] {
  if (seenAt === null) return []
  return Object.entries(changes).filter(([, change]) => change.changedAt > seenAt).map(([id]) => id)
}

// ---- word diff -------------------------------------------------------------

export type DiffOp = 'same' | 'add' | 'del'
export interface DiffSegment { op: DiffOp; text: string }

/** Above this many cells (tokens × tokens) the word diff falls back to lines, then to „old / new“ as a whole. */
const MAX_DIFF_CELLS = 400_000

/** Words with the white space after them (and leading white space as a token of its own). */
const tokensOf = (text: string): string[] => text.match(/\s+|\S+\s*/g) ?? []
/** Lines with their line break. */
const linesOf = (text: string): string[] => text.match(/[^\n]*\n|[^\n]+$/g) ?? []

/** Merges neighbouring segments of the same kind and drops empty ones. */
function merged(segments: DiffSegment[]): DiffSegment[] {
  const result: DiffSegment[] = []
  for (const segment of segments) {
    if (segment.text === '') continue
    const last = result.at(-1)
    if (last && last.op === segment.op) last.text += segment.text
    else result.push({ ...segment })
  }
  return result
}

/** The longest common subsequence diff of two token lists (common start and end trimmed first); null when too big. */
function lcsDiff(a: string[], b: string[]): DiffSegment[] | null {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  const n = midA.length
  const m = midB.length
  if (n * m > MAX_DIFF_CELLS) return null
  // lengths[i][j]: LCS of midA[i..] and midB[j..], one flat array of (n + 1) × (m + 1).
  const width = m + 1
  const lengths = new Uint32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lengths[i * width + j] = midA[i] === midB[j]
        ? lengths[(i + 1) * width + j + 1]! + 1
        : Math.max(lengths[(i + 1) * width + j]!, lengths[i * width + j + 1]!)
    }
  }
  const segments: DiffSegment[] = [{ op: 'same', text: a.slice(0, start).join('') }]
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (midA[i] === midB[j]) {
      segments.push({ op: 'same', text: midA[i]! })
      i++
      j++
    }
    else if (lengths[(i + 1) * width + j]! >= lengths[i * width + j + 1]!) {
      segments.push({ op: 'del', text: midA[i++]! })
    }
    else {
      segments.push({ op: 'add', text: midB[j++]! })
    }
  }
  while (i < n) segments.push({ op: 'del', text: midA[i++]! })
  while (j < m) segments.push({ op: 'add', text: midB[j++]! })
  segments.push({ op: 'same', text: a.slice(endA).join('') })
  return merged(segments)
}

/**
 * A word-level diff of two plain texts (line-level for long texts, the whole text as removed and added beyond that).
 * The segments are plain text, to be shown as text (never as HTML).
 */
export function textDiff(before: string, after: string): DiffSegment[] {
  if (before === after) return merged([{ op: 'same', text: before }])
  return lcsDiff(tokensOf(before), tokensOf(after))
    ?? lcsDiff(linesOf(before), linesOf(after))
    ?? merged([{ op: 'del', text: before }, { op: 'add', text: after }])
}

// ---- answer diff -----------------------------------------------------------

/** How an item's answer differs from the current one: filled since (`new`), emptied since (`removed`), or changed. */
export type DiffStatus = 'same' | 'new' | 'changed' | 'removed'

export type AnswerDiffDetail =
  /** The text as plain text (formatted answers through the sanitizer's parser), word by word. */
  | { kind: 'text'; segments: DiffSegment[] }
  /** Option labels ticked since (`added`), no longer ticked (`removed`) and ticked in both (`kept`), in the item's order. */
  | { kind: 'choices'; added: string[]; removed: string[]; kept: string[] }
  | { kind: 'rating'; from: RatingValue | null; to: RatingValue | null; remarkFrom: string; remarkTo: string }
  | { kind: 'milestone'; from: boolean; to: boolean; remarkFrom: string; remarkTo: string }
  | { kind: 'date'; from: string | null; to: string | null }

export type AnswerDiff = { status: 'same' } | { status: Exclude<DiffStatus, 'same'>; detail: AnswerDiffDetail }

function detailOf(item: AnswerableItem, before: FormAnswer, after: FormAnswer): AnswerDiffDetail {
  switch (item.kind) {
    case 'text': return { kind: 'text', segments: textDiff(richTextToPlain(textOf(before)), richTextToPlain(textOf(after))) }
    case 'choices': {
      const was = new Set(choicesOf(before))
      const is = new Set(choicesOf(after))
      const labels = (keep: (option: string) => boolean) => item.options.filter(option => keep(option.id)).map(option => option.label)
      return {
        kind: 'choices', added: labels(id => is.has(id) && !was.has(id)), removed: labels(id => was.has(id) && !is.has(id)),
        kept: labels(id => was.has(id) && is.has(id)),
      }
    }
    case 'rating': {
      const was = ratingOf(before)
      const is = ratingOf(after)
      return { kind: 'rating', from: was.value, to: is.value, remarkFrom: was.remark, remarkTo: is.remark }
    }
    case 'milestone': {
      const was = milestoneOf(before)
      const is = milestoneOf(after)
      return { kind: 'milestone', from: was.reached, to: is.reached, remarkFrom: was.remark, remarkTo: is.remark }
    }
    case 'date': return { kind: 'date', from: dateOf(before), to: dateOf(after) }
  }
}

/** How the item's answer in `before` (a stored state) differs from `after` (the current one). */
export function answerDiff(item: AnswerableItem, before: FormAnswer, after: FormAnswer): AnswerDiff {
  if (sameAnswer(item, before, after)) return { status: 'same' }
  const wasEmpty = isEmptyAnswer(item, before)
  const isEmpty = isEmptyAnswer(item, after)
  const status = wasEmpty && !isEmpty ? 'new' : !wasEmpty && isEmpty ? 'removed' : 'changed'
  return { status, detail: detailOf(item, before, after) }
}

/** The differences of every answerable item between a stored state and the current answers (unchanged ones left out). */
export function formDiff(content: FormContent, before: FormAnswers, after: FormAnswers): Record<string, AnswerDiff> {
  const result: Record<string, AnswerDiff> = {}
  for (const item of answerableItems(content)) {
    const diff = answerDiff(item, answerOf(item, before), answerOf(item, after))
    if (diff.status !== 'same') result[item.id] = diff
  }
  return result
}

// ---- comparing two forms ---------------------------------------------------

export type Trend = 'up' | 'down' | 'same'

/**
 * The rank of a rating on its scale (higher is better): the legend lists the values best first
 * (+ Stärke, ~ teilweise, − Entwicklungsbedarf).
 */
export function ratingRank(value: RatingValue): number {
  return RATING_LEGEND.entries.length - 1 - RATING_LEGEND.entries.findIndex(entry => entry.value === value)
}

/**
 * The trend from the older to the newer answer: ratings by their rank (`ratingRank`), milestones reached above not
 * reached; null for other kinds, or when one side has no rating or is not in its form.
 */
export function trendOf(item: AnswerableItem, older: FormAnswer | undefined, newer: FormAnswer | undefined): Trend | null {
  if (older === undefined || newer === undefined) return null
  let from: number
  let to: number
  if (item.kind === 'rating') {
    const was = ratingOf(older).value
    const is = ratingOf(newer).value
    if (was === null || is === null) return null
    from = ratingRank(was)
    to = ratingRank(is)
  }
  else if (item.kind === 'milestone') {
    from = milestoneOf(older).reached ? 1 : 0
    to = milestoneOf(newer).reached ? 1 : 0
  }
  else {
    return null
  }
  return to > from ? 'up' : to < from ? 'down' : 'same'
}

/** A form as the comparison reads it. */
export interface ComparedForm { content: FormContent; answers: FormAnswers }

/**
 * One item in the comparison: the item as each form has it (undefined = „nicht im Bogen“) with its answer, and the
 * trend of ratings and milestones.
 */
export interface CompareRow {
  id: string
  olderItem?: AnswerableItem
  newerItem?: AnswerableItem
  older?: FormAnswer
  newer?: FormAnswer
  trend: Trend | null
}
export interface CompareSection { id: string; title: string; rows: CompareRow[] }

/**
 * Two forms side by side, laid out by the newer form's sections and items; the older form's items it lacks follow in
 * their section (the newer form's section of the same id, else a section of the older form's title at the end). An item
 * of the same id but another kind counts as two items, each missing in the other form.
 */
export function compareForms(newer: ComparedForm, older: ComparedForm): CompareSection[] {
  const olderItems = new Map(answerableItems(older.content).map(item => [item.id, item]))
  const usedOlder = new Set<string>()
  const row = (newerItem: AnswerableItem | undefined, olderItem: AnswerableItem | undefined): CompareRow => {
    const newerAnswer = newerItem && answerOf(newerItem, newer.answers)
    const olderAnswer = olderItem && answerOf(olderItem, older.answers)
    return {
      id: (newerItem ?? olderItem)!.id, newerItem, olderItem, newer: newerAnswer, older: olderAnswer,
      trend: newerItem && olderItem ? trendOf(newerItem, olderAnswer, newerAnswer) : null,
    }
  }
  const sections: CompareSection[] = newer.content.sections.map(section => ({
    id: section.id, title: section.title,
    rows: section.items.filter(answerable).flatMap((item) => {
      const match = olderItems.get(item.id)
      if (match && match.kind === item.kind) {
        usedOlder.add(item.id)
        return [row(item, match)]
      }
      return [row(item, undefined)]
    }),
  }))
  for (const section of older.content.sections) {
    const rest = section.items.filter(answerable).filter(item => !usedOlder.has(item.id)).map(item => row(undefined, item))
    if (!rest.length) continue
    const target = sections.find(entry => entry.id === section.id)
    if (target) target.rows.push(...rest)
    else sections.push({ id: section.id, title: section.title, rows: rest })
  }
  return sections.filter(section => section.rows.length > 0)
}
