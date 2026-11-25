import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { de } from '../../app/locales/de'
import { openSignHints, openSignItemsOf, openSignPeople } from '../../app/utils/signRequestsOpen'
import type { SignRequestDto, SignRequestRecipientDto } from '../../shared/types/api'

/**
 * „Unterschriften“ on Mitarbeitende: „Wer muss noch unterschreiben?“ per person, the hint „2 offen“ in the list of
 * Mitarbeitende and the box on the person's tab „Nachweise“ – all worked out from the requests the viewer sees
 * (GET /api/sign-requests; the scoping by folder and facility: tests/services/signRequests.test.ts).
 */

const TODAY = '2026-11-25'
let nextId = 1
function recipient(employeeId: number, name: string, status: SignRequestRecipientDto['status'] = 'open'): SignRequestRecipientDto {
  return {
    id: nextId++, employeeId, name, status, signedAt: null, declinedAt: null, declineReason: null, withdrawnAt: null, remindedAt: null,
    signedDocumentId: null, signedHash: null, copyModified: false, copyDeleted: false,
  }
}
function request(title: string, dueDate: string | null, createdAt: string, recipients: SignRequestRecipientDto[]): SignRequestDto {
  return {
    id: nextId++, title, createdAt, createdBy: 'leitung', sourceKind: 'template', targetFolder: 'qualifications', dueDate, note: '',
    fileSize: 1, overdue: false, recipients,
  }
}
const page = (path: string) => readFileSync(join(process.cwd(), 'app', path), 'utf8')

describe('who still has to sign', () => {
  const requests = [
    request('Datenschutz', null, '2026-11-01T08:00:00.000Z', [recipient(1, 'Anna'), recipient(2, 'Ben', 'signed')]),
    request('Belehrung', '2026-11-20', '2026-11-10T08:00:00.000Z', [recipient(1, 'Anna'), recipient(3, 'Cleo')]),
    request('Hygiene', '2026-12-31', '2026-11-15T08:00:00.000Z', [recipient(1, 'Anna'), recipient(2, 'Ben')]),
    request('Alt', '2026-11-01', '2026-10-01T08:00:00.000Z', [recipient(2, 'Ben', 'withdrawn'), recipient(3, 'Cleo', 'declined')]),
  ]

  it('lists each person with open requests, the overdue ones first, then by due date (none last)', () => {
    const people = openSignPeople(requests, TODAY)
    expect(people.map(person => [person.name, person.overdue, person.items.map(item => [item.request.title, item.overdue])])).toEqual([
      // Whoever has overdue ones comes first, then by name; signed, declined and withdrawn ones are not open.
      ['Anna', 1, [['Belehrung', true], ['Hygiene', false], ['Datenschutz', false]]],
      ['Cleo', 1, [['Belehrung', true]]],
      ['Ben', 0, [['Hygiene', false]]],
    ])
    // The due day itself is not overdue yet.
    expect(openSignPeople(requests, '2026-11-20').every(person => person.overdue === 0)).toBe(true)
    expect(openSignPeople([], TODAY)).toEqual([])
  })

  it('gives one person\'s open requests for the box on „Nachweise“', () => {
    expect(openSignItemsOf(requests, 1, TODAY).map(item => item.request.title)).toEqual(['Belehrung', 'Hygiene', 'Datenschutz'])
    expect(openSignItemsOf(requests, 4, TODAY)).toEqual([])
  })

  it('makes the hint in the list: „n offen“, red once one is overdue, none without open ones', () => {
    const hints = openSignHints(requests, TODAY)
    expect(hints.get(1)).toEqual({ count: 3, overdue: 1, color: 'error' })
    expect(hints.get(2)).toEqual({ count: 1, overdue: 0, color: 'warning' })
    expect(hints.has(4)).toBe(false)
    expect(de.signRequests.listHint(3)).toBe('3 offen')
    expect(de.signRequests.listHintTitle(3, 1)).toBe('3 Dokumente noch nicht unterschrieben, davon 1 überfällig')
    expect(de.signRequests.listHintTitle(1, 0)).toBe('1 Dokument noch nicht unterschrieben')
  })

  it('shows them only to senders, from the same request as the list of sent requests (no other data)', () => {
    // One fetch for all of them, only with the right to send.
    const composable = page('composables/useSignRequests.ts')
    expect(composable).toContain("useFetch<SignRequestDto[]>('/api/sign-requests'")
    expect(composable).toContain("can('signRequests.manage')")
    for (const path of ['pages/admin/employees/index.vue', 'components/signRequests/OpenByPerson.vue', 'components/signRequests/Overview.vue', 'components/employees/SignRequestsSection.vue']) {
      expect(page(path), path).toContain('useSignRequests(')
      expect(page(path), path).not.toContain("'/api/sign-requests'")
    }
    // The box on „Nachweise“ is mounted only with the right.
    expect(page('pages/admin/employees/[id].vue')).toContain(`<EmployeesSignRequestsSection v-if="can('signRequests.manage')"`)
    // The children page shows „Unfälle“ with the right to the accident reports.
    expect(page('pages/children/index.vue')).toContain("accidents: can('accidents.manage')")
  })
})
