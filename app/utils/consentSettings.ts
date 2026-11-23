// The order moves of the settings for consent questions and overview tabs (Einstellungen → Kinder). Each returns the
// new order of the whole list as ids (what the order routes take), or null when nothing moves.
import { consentAreas } from '#shared/domain/childConsents'

interface Ordered { id: number; area: string }

/** A question one place up (-1) or down (+1) within its area: it swaps with the neighbour of the same area. */
export function moveQuestion(questions: readonly Ordered[], id: number, direction: -1 | 1): number[] | null {
  const question = questions.find(entry => entry.id === id)
  if (!question) return null
  const sameArea = questions.filter(entry => entry.area === question.area)
  const neighbour = sameArea[sameArea.indexOf(question) + direction]
  if (!neighbour) return null
  return questions.map(entry => (entry.id === id ? neighbour.id : entry.id === neighbour.id ? id : entry.id))
}

/** A whole area one place up or down among the areas (the areas are ordered by their first question). */
export function moveArea(questions: readonly Ordered[], area: string, direction: -1 | 1): number[] | null {
  const areas = consentAreas(questions)
  const index = areas.indexOf(area)
  const target = index + direction
  if (index < 0 || target < 0 || target >= areas.length) return null
  ;[areas[index], areas[target]] = [areas[target]!, areas[index]!]
  return areas.flatMap(name => questions.filter(entry => entry.area === name).map(entry => entry.id))
}

/** An entry of a plain list one place up or down (tabs; columns of a tab). */
export function moveInList<T>(list: readonly T[], index: number, direction: -1 | 1): T[] | null {
  const target = index + direction
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return null
  const next = [...list]
  ;[next[index], next[target]] = [next[target]!, next[index]!]
  return next
}
