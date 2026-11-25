import { describe, expect, it } from 'vitest'
import type { ApplicantVisitListItemDto, InfoVisitListItemDto } from '../../shared/types/api'
import {
  ALL_STATUSES, applicantBody, dayRangeText, emptyApplicantForm, emptyInfoVisitForm, filterApplicants, filterInfoVisits, infoVisitBody,
  visitTimeText, visitTimeValue,
} from '../../app/utils/visits'

const info = (id: number, familyName: string, status: InfoVisitListItemDto['status'], childFirstName = ''): InfoVisitListItemDto => ({
  id, visitDate: '2026-11-20', visitStart: null, familyName, childFirstName, childLastName: '', status, childId: null, guidedBy: '',
  phone: '', email: '', documentCount: 0, formCount: 0, updatedAt: 'x',
})
const applicant = (id: number, name: string, status: ApplicantVisitListItemDto['status']): ApplicantVisitListItemDto => ({
  id, name, kind: 'hospitation', status, declinedAt: null, employeeId: null, firstDay: null, lastDay: null, dayCount: 0, mentorName: 'Anna',
  phone: '', email: '', documentCount: 0, formCount: 0, updatedAt: 'x',
})

describe('visit lists and forms', () => {
  it('filters by search words (umlauts aside) and status', () => {
    const items = [info(1, 'Müller', 'open', 'Lena'), info(2, 'Berg', 'declined'), info(3, 'Kurz', 'waitlisted')]
    expect(filterInfoVisits(items, 'mueller', ALL_STATUSES).map(item => item.id)).toEqual([1])
    expect(filterInfoVisits(items, 'lena', ALL_STATUSES).map(item => item.id)).toEqual([1])
    expect(filterInfoVisits(items, '', 'declined').map(item => item.id)).toEqual([2])
    const people = [applicant(1, 'Mara', 'open'), applicant(2, 'Ole', 'hired')]
    expect(filterApplicants(people, 'anna', 'open').map(item => item.id)).toEqual([1])
  })

  it('turns the form values into the bodies', () => {
    expect(infoVisitBody({ ...emptyInfoVisitForm('2026-11-25'), familyName: 'Berg', visitStart: '10:30' }, 'declined')).toMatchObject({
      visitDate: '2026-11-25', visitStart: 630, childBirthDate: null, desiredStart: null, status: 'declined',
    })
    expect(applicantBody({ ...emptyApplicantForm(), days: [{ date: '2026-12-01', from: '8:00', to: '' }] }).days)
      .toEqual([{ date: '2026-12-01', from: 480, to: null }])
    expect(visitTimeText(null)).toBe('')
    expect(visitTimeText(540)).toBe('9:00')
    expect(visitTimeValue(' ')).toBeNull()
  })

  it('shows the days as one line', () => {
    expect(dayRangeText({ firstDay: null, lastDay: null })).toBe('')
    expect(dayRangeText({ firstDay: '2026-12-01', lastDay: '2026-12-01' })).toBe('01.12.2026')
    expect(dayRangeText({ firstDay: '2026-12-01', lastDay: '2026-12-05' })).toBe('01.12.2026 – 05.12.2026')
  })
})
