import { describe, expect, it } from 'vitest'
import {
  addMonths, BEFORE_START_KEYS, BUILTIN_REQUIREMENTS, dueState, isBeforeStartKey, isYouthExamKey, nextDueOn, requirementState, YOUTH_EXAM_KEYS,
} from '../../shared/domain/requirements'

describe('addMonths', () => {
  it('keeps the day of the month where the target month has it', () => {
    expect(addMonths('2026-01-15', 1)).toBe('2026-02-15')
    expect(addMonths('2026-10-12', 2)).toBe('2026-12-12')
    expect(addMonths('2026-10-12', 24)).toBe('2028-10-12')
    expect(addMonths('2026-10-12', 60)).toBe('2031-10-12')
    expect(addMonths('2026-10-12', 0)).toBe('2026-10-12')
  })
  it('crosses the end of the year', () => {
    expect(addMonths('2026-11-30', 2)).toBe('2027-01-30')
    expect(addMonths('2026-12-01', 1)).toBe('2027-01-01')
    expect(addMonths('2026-12-31', 12)).toBe('2027-12-31')
  })
  it('clamps to the last day of a shorter month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28')
    expect(addMonths('2027-08-31', 6)).toBe('2028-02-29')
    expect(addMonths('2026-03-31', 1)).toBe('2026-04-30')
    expect(addMonths('2024-02-29', 12)).toBe('2025-02-28')
    expect(addMonths('2024-02-29', 48)).toBe('2028-02-29')
  })
  it('goes back for negative months', () => {
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
    expect(addMonths('2026-01-15', -2)).toBe('2025-11-15')
  })
})

describe('requirementState', () => {
  const today = '2026-10-12'

  it('is missing without a record, whatever the interval', () => {
    expect(requirementState(null, 24, today)).toEqual({ state: 'missing', dueOn: null })
    expect(requirementState(null, null, today)).toEqual({ state: 'missing', dueOn: null })
  })
  it('is ok for a kind needed once as soon as a record exists, however old', () => {
    expect(requirementState('2001-05-03', null, today)).toEqual({ state: 'ok', dueOn: null })
    expect(requirementState(today, null, today)).toEqual({ state: 'ok', dueOn: null })
  })
  it('is overdue from the due day on', () => {
    // Due today counts as overdue.
    expect(requirementState('2024-10-12', 24, today)).toEqual({ state: 'overdue', dueOn: '2026-10-12' })
    expect(requirementState('2024-10-11', 24, today)).toEqual({ state: 'overdue', dueOn: '2026-10-11' })
    expect(requirementState('2019-01-01', 60, today)).toEqual({ state: 'overdue', dueOn: '2024-01-01' })
  })
  it('is soon from tomorrow until exactly two months ahead', () => {
    expect(requirementState('2024-10-13', 24, today)).toEqual({ state: 'soon', dueOn: '2026-10-13' })
    expect(requirementState('2024-11-30', 24, today)).toEqual({ state: 'soon', dueOn: '2026-11-30' })
    // Due exactly two months from today counts as soon; one day later is ok.
    expect(requirementState('2024-12-12', 24, today)).toEqual({ state: 'soon', dueOn: '2026-12-12' })
    expect(requirementState('2024-12-13', 24, today)).toEqual({ state: 'ok', dueOn: '2026-12-13' })
    expect(requirementState('2026-10-01', 24, today)).toEqual({ state: 'ok', dueOn: '2028-10-01' })
  })
  it('clamps the due date and the end of the warning window to the end of the month', () => {
    // A record dated 31 August with a 6-month interval is due on the last day of February.
    expect(requirementState('2026-08-31', 6, '2026-09-01')).toEqual({ state: 'ok', dueOn: '2027-02-28' })
    expect(requirementState('2027-08-31', 6, '2027-09-01')).toEqual({ state: 'ok', dueOn: '2028-02-29' })
    expect(requirementState('2026-08-31', 6, '2027-02-27')).toEqual({ state: 'soon', dueOn: '2027-02-28' })
    expect(requirementState('2026-08-31', 6, '2027-02-28')).toEqual({ state: 'overdue', dueOn: '2027-02-28' })
    // The window from 31 December ends on 28 February.
    expect(requirementState('2026-08-31', 6, '2026-12-31')).toEqual({ state: 'soon', dueOn: '2027-02-28' })
    expect(requirementState('2026-09-01', 6, '2026-12-31')).toEqual({ state: 'ok', dueOn: '2027-03-01' })
    expect(requirementState('2026-08-31', 6, '2026-12-27')).toEqual({ state: 'ok', dueOn: '2027-02-28' })
    expect(requirementState('2026-08-31', 6, '2026-12-28')).toEqual({ state: 'soon', dueOn: '2027-02-28' })
  })
  it('counts a record of the future from its own date', () => {
    expect(requirementState('2026-11-01', 1, today)).toEqual({ state: 'soon', dueOn: '2026-12-01' })
    expect(requirementState('2026-11-01', 24, today)).toEqual({ state: 'ok', dueOn: '2028-11-01' })
  })
})

describe('nextDueOn: a first interval counted from the start of employment (ArbMedVV, AMR 2.1)', () => {
  const doctor = { intervalMonths: 36, firstIntervalMonths: 12 }
  const start = '2026-08-01'

  it('dues the second check-up at start + 12 months when the only record is the first one of this employment', () => {
    // Before the start (at most 3 months), on the start, or late within the first 12 months.
    expect(nextDueOn('2026-05-01', 1, doctor, start)).toBe('2027-08-01')
    expect(nextDueOn('2026-07-15', 1, doctor, start)).toBe('2027-08-01')
    expect(nextDueOn(start, 1, doctor, start)).toBe('2027-08-01')
    expect(nextDueOn('2027-07-31', 1, doctor, start)).toBe('2027-08-01')
  })

  it('counts 36 months from the newest record otherwise: more records, or a single older or later one', () => {
    // Long-serving staff with only their latest check-up entered: no false „überfällig“.
    expect(nextDueOn('2025-06-01', 1, doctor, '2012-03-01')).toBe('2028-06-01')
    // A single check-up a year after the start is not the first one of this employment.
    expect(nextDueOn('2027-08-01', 1, doctor, start)).toBe('2030-08-01')
    // Older than 3 months before the start (e.g. from a former employment).
    expect(nextDueOn('2026-04-30', 1, doctor, start)).toBe('2029-04-30')
    // The second check-up done: every 36 months.
    expect(nextDueOn('2027-07-01', 2, doctor, start)).toBe('2030-07-01')
  })

  it('counts the first interval from the record without a known start; kinds without one and kinds needed once', () => {
    expect(nextDueOn('2026-07-15', 1, doctor, null)).toBe('2027-07-15')
    expect(nextDueOn('2026-07-15', 1, { intervalMonths: 24, firstIntervalMonths: null }, start)).toBe('2028-07-15')
    expect(nextDueOn('2026-07-15', 1, { intervalMonths: null, firstIntervalMonths: 12 }, start)).toBeNull()
  })

  it('gives the Betriebsarzt the first before the start, the second 12 months after the start, then every 36 months', () => {
    const kind = BUILTIN_REQUIREMENTS.find(type => type.key === 'company_doctor')!
    const state = (records: string[], today: string) => (records.length === 0
      ? requirementState(null, kind.intervalMonths, today)
      : dueState(nextDueOn(records.at(-1)!, records.length, kind, start), today))
    expect(state([], '2026-06-01')).toEqual({ state: 'missing', dueOn: null })
    expect(state(['2026-07-15'], '2026-08-01')).toEqual({ state: 'ok', dueOn: '2027-08-01' })
    expect(state(['2026-07-15', '2027-07-01'], '2027-08-01')).toEqual({ state: 'ok', dueOn: '2030-07-01' })
    expect(state(['2026-07-15', '2027-07-01', '2030-06-20'], '2030-07-01')).toEqual({ state: 'ok', dueOn: '2033-06-20' })
  })
})

describe('built-in kinds', () => {
  it('are the agreed ones with their default intervals, the two examinations of the JArbSchG and the IfSG Belehrung', () => {
    expect(BUILTIN_REQUIREMENTS).toEqual([
      { key: 'company_doctor', name: 'Betriebsarzt', intervalMonths: 36, firstIntervalMonths: 12 },
      { key: 'first_aid', name: 'Erste-Hilfe-Kurs', intervalMonths: 24, firstIntervalMonths: null },
      { key: 'criminal_record', name: 'Erweitertes Führungszeugnis', intervalMonths: 60, firstIntervalMonths: null },
      { key: 'measles', name: 'Masernimpfung (Nachweis)', intervalMonths: null, firstIntervalMonths: null },
      { key: 'youth_initial', name: 'Erstuntersuchung (§ 32 JArbSchG)', intervalMonths: null, firstIntervalMonths: null },
      { key: 'youth_followup', name: 'Nachuntersuchung (§ 33 JArbSchG)', intervalMonths: null, firstIntervalMonths: null },
      { key: 'ifsg_briefing', name: 'Belehrung Infektionsschutz (§ 34 Abs. 5a IfSG)', intervalMonths: 24, firstIntervalMonths: null },
    ])
    expect(YOUTH_EXAM_KEYS.every(isYouthExamKey)).toBe(true)
    expect(isYouthExamKey('measles')).toBe(false)
    expect(isYouthExamKey(null)).toBe(false)
    expect(BEFORE_START_KEYS.every(isBeforeStartKey)).toBe(true)
    expect(isBeforeStartKey('first_aid')).toBe(false)
    expect(isBeforeStartKey(null)).toBe(false)
  })
})
