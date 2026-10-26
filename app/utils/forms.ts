import {
  emptyAnswer, type AnswerableItem, type FormAnswer, type FormAnswers, type FormContent, type FormItem, type FormSection,
} from '#shared/domain/forms'

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

/** Whether a text answer is empty (then print shows writing lines). */
export const isBlank = (value: unknown) => typeof value !== 'string' || value.trim() === ''
