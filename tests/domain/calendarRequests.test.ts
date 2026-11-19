import { describe, expect, it } from 'vitest'
import { requestCells, requestText, showRequestsFrom } from '../../app/utils/calendarRequests'
import type { CalendarLeaveRequestDto } from '../../shared/types/api'

const anna: CalendarLeaveRequestDto = {
  id: 4, employeeId: 1, kind: 'vacation', startDate: '2026-11-02', endDate: '2026-11-04', workdays: 3,
  createdAt: '2026-10-07T10:00:00.000Z', dates: ['2026-11-02', '2026-11-03', '2026-11-04'],
}

describe('open leave requests in the year calendar (texts and toggle)', () => {
  it('shows the requests unless this device switched them off', () => {
    expect(showRequestsFrom(null)).toBe(true)
    expect(showRequestsFrom('true')).toBe(true)
    expect(showRequestsFrom('false')).toBe(false)
    expect(showRequestsFrom('irgendwas')).toBe(true)
  })

  it('finds the request of a person on a day', () => {
    const berta = { ...anna, id: 5, employeeId: 2, kind: 'overtime_off' as const, startDate: '2026-12-01', endDate: '2026-12-01', workdays: 1, dates: ['2026-12-01'] }
    const cells = requestCells([anna, berta])
    expect(cells.get(1)?.get('2026-11-03')?.id).toBe(4)
    expect(cells.get(1)?.get('2026-12-01')).toBeUndefined()
    expect(cells.get(2)?.get('2026-12-01')?.id).toBe(5)
  })

  it('describes a request with period, days, kind and when it was made', () => {
    expect(requestText(anna)).toBe('beantragt: Urlaub 02.11.2026 – 04.11.2026, 3 Tage, beantragt am 07.10.2026')
    expect(requestText({ ...anna, kind: 'overtime_off', endDate: '2026-11-02', workdays: 1 }))
      .toBe('beantragt: Überstundenfrei 02.11.2026, 1 Tag, beantragt am 07.10.2026')
  })
})
