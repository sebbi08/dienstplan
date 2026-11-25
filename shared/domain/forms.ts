import { isValidIsoDate } from './dates'
import { isRichText, richTextLength, sanitizeRichText } from './richText'
import type { IsoDate } from './types'

/**
 * Form kinds: „Mitarbeitergespräch“, „Kind“, „Teamsitzung“, „Unfall“ (an accident report about a child or an employee),
 * „Infogespräch“ and „Hospitation“ (the forms of an info visit or an applicant, server/services/visits.ts).
 */
export type FormKind = 'staff' | 'child' | 'team' | 'accident' | 'info' | 'applicant'
export const FORM_KINDS: readonly FormKind[] = ['staff', 'child', 'team', 'accident', 'info', 'applicant']

/** Whom an accident template (and the forms made from it) is about; null on the templates of the other kinds. */
export type FormSubject = 'child' | 'employee'
export const FORM_SUBJECTS: readonly FormSubject[] = ['child', 'employee']

/**
 * Prefill keys (optional `prefill` on text, date and choices items): when an accident form is made, such an item's
 * answer is filled from the app's data where it exists; afterwards it is an ordinary answer (editable, never filled
 * again). The key belongs to the item, so copies and edits of the starter keep it. Each key fits one item kind:
 * - facility (text): the facility's name and address („1 Name und Anschrift des Unternehmens“)
 * - personName (text): the person's name („4 Name, Vorname“; a child's first and last name)
 * - birthDate (date): the birth date („5“)
 * - address (text): the employee's street, postal code and city („6“)
 * - healthInsurer (text): the employee's health insurer („13“)
 * - homeOffice (choices): ticks the option „Ja“ when the employee had a home-office entry on the accident day („17“)
 * - workingTime (text): begin and end of the employee's stamped (else planned) working time on the accident day („23“)
 * - jobTitle (text): the employee's job title, else the qualification („24“)
 * - employedSince (date): „In der Einrichtung seit“ („25“)
 * - group (text): the person's group („26“)
 * - facilityPhone (text): the facility's phone number („29“)
 * What is filled also depends on what the acting person may read (see server/services/accidents.ts).
 */
export const PREFILL_KINDS = {
  facility: 'text', personName: 'text', birthDate: 'date', address: 'text', healthInsurer: 'text', homeOffice: 'choices',
  workingTime: 'text', jobTitle: 'text', employedSince: 'date', group: 'text', facilityPhone: 'text',
} as const satisfies Record<string, 'text' | 'date' | 'choices'>
export type PrefillKey = keyof typeof PREFILL_KINDS
export const PREFILL_KEYS = Object.keys(PREFILL_KINDS) as PrefillKey[]

export type ItemKind = 'note' | 'text' | 'choices' | 'rating' | 'milestone' | 'date'
export const ITEM_KINDS: readonly ItemKind[] = ['note', 'text', 'choices', 'rating', 'milestone', 'date']

export interface ChoiceOption { id: string; label: string }

export type FormItem =
  | { id: string; kind: 'note'; text: string }
  | { id: string; kind: 'text'; question: string; prefill?: PrefillKey }
  | { id: string; kind: 'choices'; question: string; options: ChoiceOption[]; prefill?: PrefillKey }
  | { id: string; kind: 'rating'; criterion: string }
  | { id: string; kind: 'milestone'; text: string; ageLabel: string }
  | { id: string; kind: 'date'; question: string; prefill?: PrefillKey }

/** An item as typed in the editor: no item id yet, options may lack ids. */
type Draft<T> = T extends { kind: 'choices' }
  ? Omit<T, 'id' | 'options'> & { options: { id?: string; label: string }[] }
  : Omit<T, 'id'>
export type ItemDraft = FormItem extends infer T ? (T extends FormItem ? Draft<T> : never) : never
/** Items that take an answer (everything but notes). */
export type AnswerableItem = Exclude<FormItem, { kind: 'note' }>

export interface FormSection { id: string; title: string; hint: string; items: FormItem[] }
export interface FormContent { sections: FormSection[] }
export interface SectionDraft { title: string; hint: string }

export type FormAnswers = Record<string, unknown>
/** Plain text (stored before the formatting) or formatted text as sanitized HTML (shared/domain/richText.ts). */
export type TextAnswer = string
/** Ids of the ticked options, no duplicates. */
export type ChoicesAnswer = string[]
export type RatingValue = '+' | '~' | '-'
export interface RatingAnswer { value: RatingValue | null; remark: string }
export interface MilestoneAnswer { reached: boolean; remark: string }
export type DateAnswer = IsoDate | null
export type FormAnswer = TextAnswer | ChoicesAnswer | RatingAnswer | MilestoneAnswer | DateAnswer

export const FORM_LIMITS = {
  sections: 60,
  itemsPerSection: 120,
  sectionTitle: 120,
  sectionHint: 1000,
  note: 1000,
  question: 300,
  options: 40,
  // 100: the official option „mit der Unternehmerin/dem Unternehmer in eingetragener Lebenspartnerschaft lebend“ (U 1000).
  optionLabel: 100,
  ageLabel: 20,
  /** Characters of a text answer (of a formatted one: see richTextLength). */
  textAnswer: 4000,
  /** The HTML of a formatted text answer, before and after sanitizing (room for lists and formatting). */
  textAnswerHtml: 40000,
  /** All formatted text answers of one save together, before sanitizing (bounds the work of one request). */
  answersHtml: 200000,
  ratingRemark: 500,
  milestoneRemark: 200,
  templateName: 80,
  id: 100,
} as const

/**
 * The legend the forms show above every section with ratings (spec §2), from the Beurteilungsbogen; not part of any
 * template. `value` is the stored rating, `symbol` what the form shows.
 */
export const RATING_LEGEND = {
  intro: 'Bewertung: Pro Kriterium bitte genau eine Spalte (+, ~ oder −) markieren.',
  entries: [
    { value: '+', symbol: '+', label: 'Stärke / entspricht den Erwartungen' },
    { value: '~', symbol: '~', label: 'teilweise erfüllt / Entwicklung möglich' },
    { value: '-', symbol: '−', label: 'Entwicklungsbedarf' },
  ],
} as const satisfies { intro: string; entries: readonly { value: RatingValue; symbol: string; label: string }[] }

/** Domain error with a machine-readable code; services map it to a 400. */
export class FormError extends Error {
  constructor(public readonly code: string) {
    super(code)
    this.name = 'FormError'
  }
}

// ---- content -------------------------------------------------------------

type Raw = Record<string, unknown>

const isObject = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function invalidContent(): never {
  throw new FormError('form_content_invalid')
}

function text(value: unknown, min: number, max: number): string {
  if (typeof value !== 'string') invalidContent()
  const trimmed = value.trim()
  if (trimmed.length < min || trimmed.length > max) invalidContent()
  return trimmed
}

/** Ids become answer keys; these would clash with object internals. */
const RESERVED_IDS = new Set(['__proto__', 'constructor', 'prototype'])

function id(value: unknown, seen: Set<string>): string {
  if (
    typeof value !== 'string' || value.length === 0 || value.length > FORM_LIMITS.id
    || RESERVED_IDS.has(value) || seen.has(value)
  ) {
    invalidContent()
  }
  seen.add(value)
  return value
}

/** The item's prefill key as `{ prefill }` to spread (nothing without one); a key unknown or for another kind is invalid. */
function prefillOf(raw: Raw, kind: 'text' | 'date' | 'choices'): { prefill?: PrefillKey } {
  if (raw.prefill === undefined || raw.prefill === null) return {}
  const key = raw.prefill
  if (typeof key !== 'string' || !Object.hasOwn(PREFILL_KINDS, key) || PREFILL_KINDS[key as PrefillKey] !== kind) {
    invalidContent()
  }
  return { prefill: key as PrefillKey }
}

function checkItem(raw: unknown, seen: Set<string>): FormItem {
  if (!isObject(raw)) invalidContent()
  const itemId = id(raw.id, seen)
  const L = FORM_LIMITS
  switch (raw.kind) {
    case 'note': return { id: itemId, kind: 'note', text: text(raw.text, 1, L.note) }
    case 'text': return { id: itemId, kind: 'text', question: text(raw.question, 1, L.question), ...prefillOf(raw, 'text') }
    case 'choices': {
      const question = text(raw.question ?? '', 0, L.question)
      const options = raw.options
      if (!Array.isArray(options) || options.length < 1 || options.length > L.options) invalidContent()
      return {
        id: itemId, kind: 'choices', question,
        options: options.map((option: unknown) => {
          if (!isObject(option)) invalidContent()
          return { id: id(option.id, seen), label: text(option.label, 1, L.optionLabel) }
        }),
        ...prefillOf(raw, 'choices'),
      }
    }
    case 'rating': return { id: itemId, kind: 'rating', criterion: text(raw.criterion, 1, L.question) }
    case 'milestone': return {
      id: itemId, kind: 'milestone', text: text(raw.text, 1, L.question), ageLabel: text(raw.ageLabel, 1, L.ageLabel),
    }
    case 'date': return { id: itemId, kind: 'date', question: text(raw.question, 1, L.question), ...prefillOf(raw, 'date') }
    default: return invalidContent()
  }
}

/**
 * Validates a template's (or form snapshot's) structure and returns a clean copy with trimmed
 * texts. Ids of sections, items and options must be unique across the whole content.
 */
export function checkContent(content: unknown): FormContent {
  if (!isObject(content) || !Array.isArray(content.sections)) invalidContent()
  if (content.sections.length > FORM_LIMITS.sections) invalidContent()
  const seen = new Set<string>()
  return {
    sections: content.sections.map((section: unknown) => {
      if (!isObject(section)) invalidContent()
      const sectionId = id(section.id, seen)
      const title = text(section.title, 1, FORM_LIMITS.sectionTitle)
      const hint = text(section.hint ?? '', 0, FORM_LIMITS.sectionHint)
      if (!Array.isArray(section.items) || section.items.length > FORM_LIMITS.itemsPerSection) invalidContent()
      return { id: sectionId, title, hint, items: section.items.map((item: unknown) => checkItem(item, seen)) }
    }),
  }
}

// ---- answers -------------------------------------------------------------

function invalidAnswer(): never {
  throw new FormError('form_answer_invalid')
}

function hasExactKeys(value: unknown, keys: string[]): value is Raw {
  if (!isObject(value)) return false
  const own = Object.keys(value)
  return own.length === keys.length && keys.every((key) => own.includes(key))
}

function remark(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) invalidAnswer()
  return value
}

/**
 * A text answer: formatted text (HTML, see isRichText) is sanitized to the allowed subset on every save — huge input is
 * refused before parsing, then the text (richTextLength) and the HTML are limited (400 form_answer_too_long). Plain
 * text (answers from before the formatting, never read as HTML) keeps its old limit (form_answer_invalid).
 */
function checkTextAnswer(value: unknown): TextAnswer {
  if (typeof value !== 'string') invalidAnswer()
  if (!isRichText(value)) {
    if (value.length > FORM_LIMITS.textAnswer) invalidAnswer()
    return value
  }
  if (value.length > FORM_LIMITS.textAnswerHtml) throw new FormError('form_answer_too_long')
  const html = sanitizeRichText(value)
  if (html.length > FORM_LIMITS.textAnswerHtml || richTextLength(html) > FORM_LIMITS.textAnswer) {
    throw new FormError('form_answer_too_long')
  }
  return html
}

function checkAnswer(item: FormItem, value: unknown): FormAnswer {
  switch (item.kind) {
    case 'note': return invalidAnswer()
    case 'text': return checkTextAnswer(value)
    case 'choices': {
      if (!Array.isArray(value)) invalidAnswer()
      const allowed = new Set(item.options.map((option) => option.id))
      const picked = new Set<string>()
      for (const entry of value) {
        if (typeof entry !== 'string' || !allowed.has(entry) || picked.has(entry)) invalidAnswer()
        picked.add(entry)
      }
      return [...picked]
    }
    case 'rating': {
      if (!hasExactKeys(value, ['value', 'remark'])) invalidAnswer()
      const rating = value.value
      if (rating !== null && rating !== '+' && rating !== '~' && rating !== '-') invalidAnswer()
      return { value: rating, remark: remark(value.remark, FORM_LIMITS.ratingRemark) }
    }
    case 'milestone':
      if (!hasExactKeys(value, ['reached', 'remark']) || typeof value.reached !== 'boolean') invalidAnswer()
      return { reached: value.reached, remark: remark(value.remark, FORM_LIMITS.milestoneRemark) }
    case 'date':
      if (value === null) return null
      if (typeof value !== 'string' || !isValidIsoDate(value)) invalidAnswer()
      return value
  }
}

/**
 * Validates answers against the form's own content (its snapshot). Keys must be ids of
 * answerable items; missing answers are fine. Anything invalid throws, nothing is dropped. Formatted text answers
 * together may hold at most FORM_LIMITS.answersHtml characters (form_answers_too_long, checked before any sanitizing).
 */
export function checkAnswers(content: FormContent, answers: unknown): FormAnswers {
  if (!isObject(answers)) invalidAnswer()
  const items = new Map<string, FormItem>()
  for (const section of content.sections) for (const item of section.items) items.set(item.id, item)
  // Many text items must not add up to unbounded sanitizing work: the formatted ones together are limited first.
  let html = 0
  for (const value of Object.values(answers)) if (typeof value === 'string' && isRichText(value)) html += value.length
  if (html > FORM_LIMITS.answersHtml) throw new FormError('form_answers_too_long')
  const result: FormAnswers = Object.create(null)
  for (const [key, value] of Object.entries(answers)) {
    const item = items.get(key)
    if (!item) invalidAnswer()
    result[key] = checkAnswer(item, value)
  }
  return result
}

/** The answer an untouched item has. Notes take no answer, so callers skip them. */
export function emptyAnswer(item: AnswerableItem): FormAnswer {
  switch (item.kind) {
    case 'text': return ''
    case 'choices': return []
    case 'rating': return { value: null, remark: '' }
    case 'milestone': return { reached: false, remark: '' }
    case 'date': return null
  }
}

// ---- edit helpers (pure, never mutate) -----------------------------------

export type Direction = 'up' | 'down'

function sectionIndex(content: FormContent, sectionId: string): number {
  const index = content.sections.findIndex((section) => section.id === sectionId)
  if (index < 0) throw new FormError('form_section_not_found')
  return index
}

function itemPosition(content: FormContent, itemId: string): { section: number; item: number } {
  for (let section = 0; section < content.sections.length; section++) {
    const item = content.sections[section]!.items.findIndex((entry) => entry.id === itemId)
    if (item >= 0) return { section, item }
  }
  throw new FormError('form_item_not_found')
}

function withSections(content: FormContent, sections: FormSection[]): FormContent {
  return { ...content, sections }
}

function replaceSection(content: FormContent, index: number, section: FormSection): FormContent {
  return withSections(content, content.sections.map((entry, i) => (i === index ? section : entry)))
}

function buildItem(draft: ItemDraft, itemId: string, newId: () => string): FormItem {
  if (draft.kind === 'choices') {
    const given = draft.options.flatMap((option) => (option.id === undefined ? [] : [option.id]))
    if (new Set(given).size !== given.length) throw new FormError('form_option_duplicate')
    return {
      ...draft, id: itemId,
      options: draft.options.map((option) => ({ id: option.id ?? newId(), label: option.label })),
    }
  }
  return { ...draft, id: itemId } as FormItem
}

function ensureRoom(section: FormSection): void {
  if (section.items.length >= FORM_LIMITS.itemsPerSection) throw new FormError('form_section_full')
}

export function addSection(content: FormContent, draft: SectionDraft, newId: () => string): FormContent {
  if (content.sections.length >= FORM_LIMITS.sections) throw new FormError('form_too_many_sections')
  return withSections(content, [...content.sections, { id: newId(), title: draft.title, hint: draft.hint, items: [] }])
}

export function updateSection(content: FormContent, sectionId: string, draft: SectionDraft): FormContent {
  const index = sectionIndex(content, sectionId)
  return replaceSection(content, index, { ...content.sections[index]!, title: draft.title, hint: draft.hint })
}

export function moveSection(content: FormContent, sectionId: string, direction: Direction): FormContent {
  const index = sectionIndex(content, sectionId)
  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= content.sections.length) return content
  const sections = [...content.sections]
  ;[sections[index], sections[target]] = [sections[target]!, sections[index]!]
  return withSections(content, sections)
}

export function removeSection(content: FormContent, sectionId: string): FormContent {
  const index = sectionIndex(content, sectionId)
  return withSections(content, content.sections.filter((_, i) => i !== index))
}

export function addItem(content: FormContent, sectionId: string, draft: ItemDraft, newId: () => string): FormContent {
  const index = sectionIndex(content, sectionId)
  const section = content.sections[index]!
  ensureRoom(section)
  const item = buildItem(draft, newId(), newId)
  return replaceSection(content, index, { ...section, items: [...section.items, item] })
}

/** Changes an item's texts; its id stays, options keep their ids, new options get fresh ones. */
export function updateItem(content: FormContent, itemId: string, draft: ItemDraft, newId: () => string): FormContent {
  const at = itemPosition(content, itemId)
  const section = content.sections[at.section]!
  if (section.items[at.item]!.kind !== draft.kind) throw new FormError('form_item_kind_fixed')
  const item = buildItem(draft, itemId, newId)
  return replaceSection(content, at.section, {
    ...section, items: section.items.map((entry, i) => (i === at.item ? item : entry)),
  })
}

/**
 * Moves an item one step. At the first/last position of a section it moves to the end of the
 * previous / the start of the next section; at the very top or bottom nothing changes.
 */
export function moveItem(content: FormContent, itemId: string, direction: Direction): FormContent {
  const at = itemPosition(content, itemId)
  const sections = content.sections.map((section) => ({ ...section, items: [...section.items] }))
  const items = sections[at.section]!.items
  const target = direction === 'up' ? at.item - 1 : at.item + 1
  if (target >= 0 && target < items.length) {
    ;[items[at.item], items[target]] = [items[target]!, items[at.item]!]
    return withSections(content, sections)
  }
  const neighbour = direction === 'up' ? at.section - 1 : at.section + 1
  if (neighbour < 0 || neighbour >= sections.length) return content
  ensureRoom(sections[neighbour]!)
  const [item] = items.splice(at.item, 1)
  if (direction === 'up') sections[neighbour]!.items.push(item!)
  else sections[neighbour]!.items.unshift(item!)
  return withSections(content, sections)
}

export function removeItem(content: FormContent, itemId: string): FormContent {
  const at = itemPosition(content, itemId)
  const section = content.sections[at.section]!
  return replaceSection(content, at.section, { ...section, items: section.items.filter((_, i) => i !== at.item) })
}
