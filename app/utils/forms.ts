import {
  emptyAnswer, type AnswerableItem, type FormAnswer, type FormAnswers, type FormContent, type FormItem, type FormSection,
} from '#shared/domain/forms'
import { groupTemplateChoices, type TemplateChoice } from '#shared/domain/formCategories'
import { richTextToPlain } from '#shared/domain/richText'
import { formatTime } from '#shared/domain/time'
import type {
  AccidentFormDto, ChildFormDto, FormTemplateDto, MyTalkFormDto, TeamMeetingDto, TeamMeetingListItemDto,
} from '#shared/types/api'
import { de } from '~/locales/de'
import { errorCode } from '~/utils/errors'
import { formatDate, formatDateTime } from '~/utils/format'
import { countsAsSigner, participantsLine } from '~/utils/teamMeetings'

export type MilestoneItem = Extract<FormItem, { kind: 'milestone' }>
export type RatingItem = Extract<FormItem, { kind: 'rating' }>

/**
 * How a section is laid out in the filler and in print: single items in their order, consecutive ratings as one table,
 * and all milestones of the section as one block grouped by age (at the place of the first milestone, the ages in the
 * order they first appear).
 */
export type SectionBlock =
  | { type: 'item'; item: Exclude<FormItem, { kind: 'rating' | 'milestone' }> }
  | { type: 'ratings'; items: RatingItem[] }
  | { type: 'milestones'; groups: { ageLabel: string; items: MilestoneItem[] }[] }

export function sectionBlocks(section: FormSection): SectionBlock[] {
  const blocks: SectionBlock[] = []
  let milestones: Extract<SectionBlock, { type: 'milestones' }> | null = null
  for (const item of section.items) {
    if (item.kind === 'rating') {
      const last = blocks.at(-1)
      if (last?.type === 'ratings') last.items.push(item)
      else blocks.push({ type: 'ratings', items: [item] })
    }
    else if (item.kind === 'milestone') {
      if (!milestones) {
        milestones = { type: 'milestones', groups: [] }
        blocks.push(milestones)
      }
      const group = milestones.groups.find(entry => entry.ageLabel === item.ageLabel)
      if (group) group.items.push(item)
      else milestones.groups.push({ ageLabel: item.ageLabel, items: [item] })
    }
    else {
      blocks.push({ type: 'item', item })
    }
  }
  return blocks
}

/** The rating legend stands above every section with ratings. */
export const sectionHasRating = (section: FormSection) => section.items.some(item => item.kind === 'rating')

const answerable = (item: FormItem): item is AnswerableItem => item.kind !== 'note'

/** Answers for every answerable item: the stored one, or the empty answer of an untouched item (fresh copies). */
export function filledAnswers(content: FormContent, answers: FormAnswers): Record<string, FormAnswer> {
  const result: Record<string, FormAnswer> = {}
  for (const section of content.sections) {
    for (const item of section.items) {
      if (!answerable(item)) continue
      const stored = answers[item.id]
      // A JSON copy (not structuredClone): the stored answers may come in as reactive proxies.
      result[item.id] = JSON.parse(JSON.stringify(stored === undefined ? emptyAnswer(item) : stored)) as FormAnswer
    }
  }
  return result
}

/** What the form panel shows of a form: its content, the stored answers and the last change. */
export interface FormPanelForm {
  content: FormContent
  answers: FormAnswers
  updatedAt: string
  updatedBy: string
}
/** Stores the answers, sent with the updatedAt they are based on; answers the new updatedAt (throws 409 form_changed). */
export type FormPanelSave = (answers: FormAnswers, expectedUpdatedAt: string) => Promise<{ updatedAt: string }>

/** A request function like $fetch, as far as the form panel uses it. */
export type FormFetch = (url: string, options: { method: 'PUT'; body: { answers: FormAnswers; expectedUpdatedAt: string } }) => Promise<{ updatedAt: string }>

/** The default save of the form panel: a PUT of `{ answers, expectedUpdatedAt }` to the form's URL. */
export const putAnswersTo = (url: string, request: FormFetch): FormPanelSave =>
  (answers, expectedUpdatedAt) => request(url, { method: 'PUT', body: { answers, expectedUpdatedAt } })

/** Whether the panel has unsaved edits: only when editable, the answers differ from the saved ones or the parent's own fields do. */
export const panelDirty = (editable: boolean, answersJson: string, savedJson: string, extraDirty: boolean | undefined): boolean =>
  editable && (answersJson !== savedJson || !!extraDirty)

/** The outcome of one save: the new base (updatedAt of this save), or the error and whether it was a 409 form_changed. */
export type FormSaveOutcome = { ok: true; base: string } | { ok: false; conflict: boolean; error: unknown }

/**
 * One save of the panel: sends the answers with the updatedAt they are based on (`base`); the next save is checked
 * against the updatedAt of this very save.
 */
export async function saveAnswers(save: FormPanelSave, answers: FormAnswers, base: string): Promise<FormSaveOutcome> {
  try {
    return { ok: true, base: (await save(answers, base)).updatedAt }
  }
  catch (error) {
    return { ok: false, conflict: errorCode(error) === 'form_changed', error }
  }
}

/** Whether a text answer is empty (then print shows writing lines); formatted text counts by its characters. */
export const isBlank = (value: unknown) => typeof value !== 'string' || richTextToPlain(value).trim() === ''

/** An age label like „3;0“ or „3;0 Jahre“ (years;months), as on the paper forms. */
const AGE_LABEL = /^\d{1,2};\d{1,2}(?:\s+Jahre?)?$/

/**
 * The columns of a milestone block in print: its age labels when there are 2 to 6 of them and each is like „3;0 Jahre“
 * (then the table has one column per age, as on the paper form, and each sentence is ticked in its own age's column);
 * null otherwise (rows grouped by age).
 */
export function milestoneColumns(groups: { ageLabel: string }[]): string[] | null {
  const labels = groups.map(group => group.ageLabel.trim())
  if (labels.length < 2 || labels.length > 6 || !labels.every(label => AGE_LABEL.test(label))) return null
  return groups.map(group => group.ageLabel)
}

/** What a form's printout shows besides the form itself: its header table, the signature lines and the stamps. */
export interface FormSheet {
  title: string
  content: FormContent
  answers: FormAnswers
  updatedAt: string
  updatedBy: string
  /** The PDF's name without extension. */
  fileName: string
  /** Label and value per header field, laid out two per row. */
  header: [string, string][]
  /** The signature lines under the form, side by side (none for a team meeting). */
  signatures: string[]
  /** Lines in normal print where the signatures would stand, e.g. „freigegeben am … von …“ (team meetings). */
  closing: string[]
  /** Lines like „abgegeben am …“ above „zuletzt geändert …“. */
  stamps: string[]
  /** Small print under the signatures (e.g. the attachments by name, the legal hint of an Unfallanzeige). */
  hints?: string[]
  /** A blank template to fill in by hand: no „zuletzt geändert“ / „gedruckt“ footer. */
  blank?: boolean
}

/** The printout of a staff talk's form: the employee and the talk as header, signatures of assessor and employee. */
export function talkSheet(data: MyTalkFormDto): FormSheet {
  const h = de.talks.header
  const { form, talk } = data
  return {
    title: form.title, content: form.content, answers: form.answers, updatedAt: form.updatedAt, updatedBy: form.updatedBy,
    fileName: `${form.title}-${data.employeeName}-${talk.date}`,
    header: [
      [h.name, data.employeeName], [h.facility, data.facilityName],
      [h.date, formatDate(talk.date)], [h.start, talk.start === null ? '' : formatTime(talk.start)],
      [h.participants, talk.participants], [h.period, talk.period],
    ],
    signatures: [de.talks.signatureAssessor, de.talks.signatureEmployee],
    closing: [],
    stamps: [
      ...(form.submittedAt ? [de.talks.submittedAt(formatDateTime(form.submittedAt))] : []),
      ...(form.readReleasedAt ? [de.talks.readReleasedAt(formatDateTime(form.readReleasedAt))] : []),
    ],
  }
}

/** The printout of a child's observation form: child and meeting data as header, signatures of educator and parents. */
export function childSheet(data: ChildFormDto): FormSheet {
  const h = de.childForms.header
  const name = `${data.child.firstName} ${data.child.lastName}`.trim()
  return {
    title: data.title, content: data.content, answers: data.answers, updatedAt: data.updatedAt, updatedBy: data.updatedBy,
    // No child's name in the file name: it travels in the PDF request's query (logs), like the other child printouts.
    fileName: `Beobachtung-${data.id}-${data.date}`,
    header: [
      [h.name, name], [h.birthDate, formatDate(data.child.birthDate)],
      [h.group, data.child.groupName ?? ''], [h.date, data.date ? formatDate(data.date) : ''],
      [h.start, data.start === null ? '' : formatTime(data.start)], [h.participants, data.participants],
    ],
    signatures: [de.childForms.signatureStaff, de.childForms.signatureGuardian],
    closing: [],
    stamps: [],
  }
}

/**
 * The printout of an accident report (not in the U 1000 layout): the person, Datum, Uhrzeit and the header ticks, the
 * signature lines of the subject, the attachments by name and, for an employee, the legal hint on the report.
 */
export function accidentSheet(data: AccidentFormDto): FormSheet {
  const h = de.accidents.header
  const a = de.accidents
  const yesNo = (value: boolean) => (value ? a.yes : a.no)
  const employee = data.subject === 'employee'
  return {
    title: data.title, content: data.content, answers: data.answers, updatedAt: data.updatedAt, updatedBy: data.updatedBy,
    // No name in the file name: it travels in the PDF request's query (logs), like the other child printouts.
    fileName: `Unfall-${data.id}-${data.date}`,
    header: [
      [h.person, data.personName], [employee ? h.facility : h.birthDate, employee ? data.facilityName : data.person.birthDate ? formatDate(data.person.birthDate) : ''],
      [h.group, data.person.groupName ?? ''], [h.date, data.date ? formatDate(data.date) : ''],
      [h.start, data.start === null ? '' : formatTime(data.start)], [h.doctor, yesNo(data.doctor)],
      ...(employee ? [[h.unfit, yesNo(data.unfit)] as [string, string]] : []),
      [h.reportedOn, data.reportedOn ? formatDate(data.reportedOn) : ''],
    ],
    signatures: [employee ? a.signatureEmployee : a.signatureStaff, a.signatureLead],
    closing: [],
    stamps: [],
    hints: [
      ...(data.attachments.length ? [a.attachmentsList(data.attachments.map(file => file.fileName).join(', '))] : []),
      ...(employee ? [a.legalHint] : []),
    ],
  }
}

/** The group a team meeting was held for, or „ganze Einrichtung“. */
export const teamMeetingGroup = (meeting: Pick<TeamMeetingListItemDto, 'groupName'>) => meeting.groupName ?? de.teamMeetings.wholeFacility

/** „freigegeben am … von …“ or „Entwurf – noch nicht freigegeben“, and the last reopening with its reason. */
export function teamMeetingStamps(meeting: TeamMeetingListItemDto): string[] {
  const t = de.teamMeetings
  return [
    meeting.state === 'released' && meeting.releasedAt
      ? t.releasedAt(formatDateTime(meeting.releasedAt), meeting.releasedBy ?? '')
      : t.draftStamp,
    ...(meeting.reopenReason && meeting.reopenedAt
      ? [t.reopenedAt(formatDateTime(meeting.reopenedAt), meeting.reopenedBy ?? '', meeting.reopenReason)]
      : []),
  ]
}

/**
 * Who signed the minutes, one line each with the time, then (only once released, as signing starts with the release)
 * one line naming those who still can and have not. A participant whose employee left or was deleted for good before
 * signing never can, so they are not named as open.
 */
export function teamMeetingSignatureLines(meeting: Pick<TeamMeetingDto, 'state' | 'signers'>): string[] {
  const t = de.teamMeetings
  const signed = meeting.signers.flatMap(signer => (signer.signedAt ? [t.printSigned(signer.name, formatDateTime(signer.signedAt))] : []))
  const open = meeting.state === 'released'
    ? meeting.signers.filter(signer => countsAsSigner(signer) && signer.signedAt === null).map(signer => signer.name)
    : []
  return [...signed, ...(open.length ? [t.printUnsigned(open)] : [])]
}

/**
 * The printout of a team meeting's minutes: facility, group, date, time, participants and Protokollführung as header,
 * no signature lines; instead „freigegeben am … von …“ (or „Entwurf – noch nicht freigegeben“), the last reopening and
 * who signed the minutes and who has not yet.
 */
export function teamSheet(data: TeamMeetingDto): FormSheet {
  const h = de.teamMeetings.header
  return {
    title: data.title, content: data.content, answers: data.answers, updatedAt: data.updatedAt, updatedBy: data.updatedBy,
    fileName: `${data.title}-${data.date}`,
    header: [
      [h.facility, data.facilityName], [h.group, teamMeetingGroup(data)],
      [h.date, formatDate(data.date)], [h.start, data.start === null ? '' : formatTime(data.start)],
      [h.participants, participantsLine(data.signers.map(signer => signer.name), data.participants)], [h.recorder, data.recorder],
    ],
    signatures: [],
    closing: [...teamMeetingStamps(data), ...teamMeetingSignatureLines(data)],
    stamps: [],
  }
}

/**
 * A template printed blank, to fill in by hand: the header fields of its kind with empty values (the facility filled in),
 * every answer empty (writing lines, empty boxes) and the signature lines of the kind.
 */
export function blankSheet(
  template: Pick<FormTemplateDto, 'kind' | 'name' | 'content'> & Partial<Pick<FormTemplateDto, 'subject'>>, facilityName: string,
): FormSheet {
  const t = de.talks.header
  const c = de.childForms.header
  const m = de.teamMeetings.header
  const a = de.accidents.header
  const employee = template.subject === 'employee'
  const box = `☐ ${de.accidents.yes}   ☐ ${de.accidents.no}`
  const byKind = {
    staff: {
      header: [[t.name, ''], [t.facility, facilityName], [t.date, ''], [t.start, ''], [t.participants, ''], [t.period, '']],
      signatures: [de.talks.signatureAssessor, de.talks.signatureEmployee],
    },
    child: {
      header: [[c.name, ''], [c.birthDate, ''], [c.group, ''], [c.date, ''], [c.start, ''], [c.participants, '']],
      signatures: [de.childForms.signatureStaff, de.childForms.signatureGuardian],
    },
    team: {
      header: [[m.facility, facilityName], [m.group, ''], [m.date, ''], [m.start, ''], [m.participants, ''], [m.recorder, '']],
      signatures: [de.teamMeetings.signatureRecorder, de.teamMeetings.signatureLead],
    },
    accident: {
      header: [
        [a.person, ''], [a.facility, facilityName], [a.date, ''], [a.start, ''], [a.doctor, box],
        ...(employee ? [[a.unfit, box] as [string, string]] : []), [a.reportedOn, ''],
      ],
      signatures: [employee ? de.accidents.signatureEmployee : de.accidents.signatureStaff, de.accidents.signatureLead],
    },
    info: {
      header: [[de.visits.print.family, ''], [de.visits.print.child, ''], [de.visits.print.date, ''], [de.visits.print.guidedBy, '']],
      signatures: [],
    },
    applicant: {
      header: [[de.visits.print.name, ''], [de.visits.print.kind, ''], [de.visits.print.date, ''], [de.visits.print.mentor, '']],
      signatures: [],
    },
  } satisfies Record<FormTemplateDto['kind'], { header: [string, string][]; signatures: string[] }>
  return {
    title: template.name, content: template.content, answers: {}, updatedAt: '', updatedBy: '',
    fileName: `Vorlage-${template.name}`,
    header: byKind[template.kind].header, signatures: byKind[template.kind].signatures, closing: [], stamps: [], blank: true,
  }
}

/** A template with at least two forms of the child, for „Vergleichen“: its forms newest first (as the list has them). */
export interface ComparableGroup<T> { templateId: number; title: string; forms: T[] }

/**
 * The templates of which the child has two forms or more, in the order of their newest form; forms whose template is
 * gone (deleted, or the child moved facility) are left out, as nothing says they belong together.
 */
export function comparableGroups<T extends { templateId: number | null; title: string }>(forms: readonly T[]): ComparableGroup<T>[] {
  const groups = new Map<number, ComparableGroup<T>>()
  for (const form of forms) {
    if (form.templateId === null) continue
    const group = groups.get(form.templateId)
    if (group) group.forms.push(form)
    else groups.set(form.templateId, { templateId: form.templateId, title: form.title, forms: [form] })
  }
  return [...groups.values()].filter(group => group.forms.length >= 2)
}

/**
 * The column labels of a comparison, „Bogen vom ‹Datum›“ (or `label`, e.g. „Gespräch am …“); when both forms are of the
 * same day, with their time („um … Uhr“) where they have one, so the two can be told apart.
 */
export function compareLabels(
  older: { date: string; start: number | null }, newer: { date: string; start: number | null },
  label: (date: string) => string = de.formHistory.formLabel,
): { older: string; newer: string } {
  const sameDay = older.date === newer.date
  const labelOf = (form: { date: string; start: number | null }) => {
    const day = form.date ? formatDate(form.date) : ''
    return label(sameDay && form.start !== null ? `${day} ${de.childForms.atTime(formatTime(form.start))}` : day)
  }
  return { older: labelOf(older), newer: labelOf(newer) }
}

/** Two picked forms as older and newer, by their place in the list (newest first); null unless two different ones. */
export function olderAndNewer<T extends { id: number }>(forms: readonly T[], a: number, b: number): { older: T; newer: T } | null {
  const first = forms.findIndex(form => form.id === a)
  const second = forms.findIndex(form => form.id === b)
  if (first < 0 || second < 0 || first === second) return null
  return first < second ? { newer: forms[first]!, older: forms[second]! } : { newer: forms[second]!, older: forms[first]! }
}

/**
 * An entry of a template picker (USelect): a choice, or the heading of a category's group (`type: 'label'`, not
 * selectable; its value is never used).
 */
export interface TemplatePickerItem { label: string; value: number; type?: 'label' }

/**
 * The items of a template picker (child forms, staff talks, team meetings, accidents, visits): the templates grouped by
 * „Kategorie › Unterkategorie“ in the categories' order (as the server sends them), each group headed by its path; those
 * without a category last, without a heading. Without any category one group without a heading. Empty without templates.
 */
export function templatePickerItems(templates: readonly TemplateChoice[]): TemplatePickerItem[][] {
  return groupTemplateChoices(templates).map(group => [
    ...(group.heading === null ? [] : [{ type: 'label' as const, label: group.heading, value: 0 }]),
    ...group.choices.map(choice => ({ label: choice.name, value: choice.id })),
  ])
}
