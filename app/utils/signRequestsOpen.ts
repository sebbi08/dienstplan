import { isOverdue } from '#shared/domain/signRequests'
import type { IsoDate } from '#shared/domain/types'
import type { SignRequestDto, SignRequestRecipientDto } from '#shared/types/api'

/**
 * What each person still has to sign, worked out from the requests the viewer sees (GET /api/sign-requests, the same
 * rights as the list of sent requests: no request appears here that the viewer could not see there). Used by
 * „Wer muss noch unterschreiben?“ (Mitarbeitende → Unterschriften), the hint in the list of Mitarbeitende and the box
 * on the person's tab „Nachweise“.
 */

/** One open request of a person. */
export interface OpenSignItem {
  request: SignRequestDto
  recipient: SignRequestRecipientDto
  overdue: boolean
}

/** A person with open requests: the overdue ones first, then by due date (none last), then the oldest sent first. */
export interface OpenSignPerson {
  employeeId: number
  name: string
  items: OpenSignItem[]
  overdue: number
}

const byUrgency = (a: OpenSignItem, b: OpenSignItem) => Number(b.overdue) - Number(a.overdue)
  || (a.request.dueDate ?? '9999-12-31').localeCompare(b.request.dueDate ?? '9999-12-31')
  || a.request.createdAt.localeCompare(b.request.createdAt)
  || a.request.id - b.request.id

/** The people with open requests: whoever has overdue ones first (the most first), then by name. */
export function openSignPeople(requests: readonly SignRequestDto[], today: IsoDate): OpenSignPerson[] {
  const people = new Map<number, OpenSignPerson>()
  for (const request of requests) {
    for (const recipient of request.recipients) {
      if (recipient.status !== 'open') continue
      const overdue = isOverdue(request.dueDate, today, recipient.status)
      const person = people.get(recipient.employeeId) ?? { employeeId: recipient.employeeId, name: recipient.name, items: [], overdue: 0 }
      person.items.push({ request, recipient, overdue })
      if (overdue) person.overdue++
      people.set(recipient.employeeId, person)
    }
  }
  return [...people.values()]
    .map(person => ({ ...person, items: person.items.sort(byUrgency) }))
    .sort((a, b) => b.overdue - a.overdue || a.name.localeCompare(b.name, 'de'))
}

/** The open requests of one person (the box on „Nachweise“), the most urgent first. */
export function openSignItemsOf(requests: readonly SignRequestDto[], employeeId: number, today: IsoDate): OpenSignItem[] {
  return openSignPeople(requests, today).find(person => person.employeeId === employeeId)?.items ?? []
}

/** The small hint at a person in the list of Mitarbeitende: „2 offen“, red once one is overdue; none without open ones. */
export interface OpenSignHint {
  count: number
  overdue: number
  color: 'error' | 'warning'
}

/** The hints by employee id. */
export function openSignHints(requests: readonly SignRequestDto[], today: IsoDate): Map<number, OpenSignHint> {
  return new Map(openSignPeople(requests, today).map(person => [person.employeeId, {
    count: person.items.length, overdue: person.overdue, color: person.overdue > 0 ? 'error' : 'warning',
  }]))
}
