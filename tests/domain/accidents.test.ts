import { describe, expect, it } from 'vitest'
import { de } from '../../app/locales/de'
import { JOB_TITLES, QUALIFICATION_TITLES, reportDue, reportState } from '../../shared/domain/accidents'

describe('accident domain', () => {
  it('keeps the prefill words of job titles and qualifications equal to the app\'s texts', () => {
    const { other: _other, ...jobs } = de.contract.jobs
    expect(JOB_TITLES).toEqual(jobs)
    // students as an activity („Studierende/r …“), everything else as in the app
    const { none: _none, studium_1: _s1, studium_2: _s2, studium_3: _s3, ...qualifications } = de.staffing.qualifications
    const { studium_1, studium_2, studium_3, ...titles } = QUALIFICATION_TITLES
    expect(titles).toEqual(qualifications)
    expect([studium_1, studium_2, studium_3]).toEqual([
      'Studierende/r praxisintegriert/dual (1. Studienjahr)', 'Studierende/r praxisintegriert/dual (2. Studienjahr)',
      'Studierende/r praxisintegriert/dual (ab 3. Studienjahr)',
    ])
  })

  it('a report is due with Arztbesuch or arbeitsunfähig until reported; overdue after 3 days', () => {
    expect(reportDue({ doctor: true, unfit: false, reportedOn: null })).toBe(true)
    expect(reportDue({ doctor: false, unfit: true, reportedOn: null })).toBe(true)
    expect(reportDue({ doctor: true, unfit: true, reportedOn: '2026-11-18' })).toBe(false)
    expect(reportDue({ doctor: false, unfit: false, reportedOn: null })).toBe(false)
    expect(['2026-11-17', '2026-11-19', '2026-11-20', '2026-11-21'].map(today => reportState('2026-11-17', today)))
      .toEqual(['upcoming', 'upcoming', 'today', 'overdue'])
  })
})
