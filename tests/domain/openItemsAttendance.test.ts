import { describe, expect, it } from 'vitest'
import { openItemLinks } from '../../app/utils/openItems'
import type { MyOpenItemsDto } from '../../shared/types/api'

const NOTHING: MyOpenItemsDto = { knowledge: 0, sign: 0, signOverdue: 0, selfAssessments: 0, leaveDecisions: 0, leaveNotice: false, requirements: 0 }

describe('„Offen für dich“: Pflichttermine to confirm', () => {
  it('links to the year calendar opening the first appointment, last in the list', () => {
    expect(openItemLinks(NOTHING)).toEqual([])
    const links = openItemLinks({ ...NOTHING, requirements: 1, attendance: { count: 2, eventId: 9, year: 2026 } })
    expect(links.map(link => [link.key, link.label, link.to])).toEqual([
      ['requirements', '1 Pflichttermin überfällig', '/my/requirements'],
      ['attendance', '2 Pflichttermine: Teilnahme bestätigen', '/admin/calendar?year=2026&attendance=9'],
    ])
    expect(openItemLinks({ ...NOTHING, attendance: { count: 1, eventId: 3, year: 2027 } })[0]!.label).toBe('1 Pflichttermin: Teilnahme bestätigen')
  })
})
