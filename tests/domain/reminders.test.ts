import { describe, expect, it } from 'vitest'
import { docDue, inWindow, nextBirthday, sortReminders, type DocSettings, type ReminderKind } from '../../shared/domain/reminders'

const interval = (intervalMonths = 12, leadWeeks = 2): DocSettings => ({ mode: 'interval', intervalMonths, leadWeeks })
const birthday = (leadWeeks = 2): DocSettings => ({ mode: 'birthday', intervalMonths: 12, leadWeeks })
const child = (over: Partial<Parameters<typeof docDue>[0]> = {}) => ({
  birthDate: '2022-03-15', entryDate: '2024-09-01', plannedEntryDate: null, since: null, lastDone: null, ...over,
})

describe('docDue, interval mode', () => {
  it('is null when the mode is off', () => {
    expect(docDue(child(), { mode: 'off', intervalMonths: 12, leadWeeks: 2 }, '2026-10-19')).toBeNull()
  })

  it('counts from the last done date', () => {
    expect(docDue(child({ lastDone: '2026-01-31' }), interval(1), '2026-10-19')).toBe('2026-02-28')
    expect(docDue(child({ lastDone: '2026-03-10' }), interval(12), '2026-10-19')).toBe('2027-03-10')
  })

  it('counts from the entry date without a done date', () => {
    expect(docDue(child({ entryDate: '2026-04-01' }), interval(6), '2026-10-19')).toBe('2026-10-01')
  })

  it('falls back to the planned entry date when there is no entry date', () => {
    expect(docDue(child({ entryDate: null, plannedEntryDate: '2026-11-01' }), interval(3), '2026-10-19')).toBe('2027-02-01')
  })

  it('prefers the entry date over the planned entry date', () => {
    expect(docDue(child({ entryDate: '2026-04-01', plannedEntryDate: '2026-11-01' }), interval(6), '2026-10-19')).toBe('2026-10-01')
  })

  it('has no reminder without any entry date and no done date, and does not throw', () => {
    expect(docDue(child({ entryDate: null, plannedEntryDate: null }), interval(), '2026-10-19')).toBeNull()
  })

  it('counts from „gilt seit“ when it is later than the entry, else from the entry', () => {
    // long enrolled, switched on today: not overdue, due one interval after today
    expect(docDue(child({ entryDate: '2021-09-01', since: '2026-10-19' }), interval(12), '2026-10-19')).toBe('2027-10-19')
    // entered after „gilt seit“: counts from the entry
    expect(docDue(child({ entryDate: '2026-11-01', since: '2026-10-19' }), interval(6), '2026-11-02')).toBe('2027-05-01')
    expect(docDue(child({ entryDate: null, plannedEntryDate: '2027-01-01', since: '2026-10-19' }), interval(3), '2026-10-19'))
      .toBe('2027-04-01')
    // no entry date at all: „gilt seit“ alone
    expect(docDue(child({ entryDate: null, since: '2026-10-19' }), interval(3), '2026-10-19')).toBe('2027-01-19')
  })

  it('a done date wins over „gilt seit“', () => {
    expect(docDue(child({ since: '2026-10-19', lastDone: '2026-05-05' }), interval(12), '2026-10-19')).toBe('2027-05-05')
  })

  it('without a done date an overdue day stays put', () => {
    const lena = child({ entryDate: '2025-01-01', since: '2025-06-01' })
    expect(docDue(lena, interval(12), '2026-06-02')).toBe('2026-06-01')
    expect(docDue(lena, interval(12), '2026-10-19')).toBe('2026-06-01')
  })

  it('still counts from the done date when there is no entry date at all', () => {
    expect(docDue(child({ entryDate: null, lastDone: '2026-05-05' }), interval(12), '2026-10-19')).toBe('2027-05-05')
  })
})

describe('docDue, birthday mode', () => {
  const today = '2026-10-19'

  it('without a done date is the first birthday on or after the later of entry and „gilt seit“', () => {
    expect(docDue(child({ birthDate: '2022-12-01', since: today }), birthday(), today)).toBe('2026-12-01')
    expect(docDue(child({ birthDate: '2022-03-15', since: today }), birthday(), today)).toBe('2027-03-15')
    expect(docDue(child({ birthDate: '2022-10-19', since: today }), birthday(), today)).toBe('2026-10-19')
    // entered after „gilt seit“: counts from the entry
    expect(docDue(child({ birthDate: '2022-03-15', entryDate: '2027-04-01', since: today }), birthday(), today)).toBe('2028-03-15')
    // without „gilt seit“ from the entry
    expect(docDue(child({ birthDate: '2022-12-01', entryDate: '2024-09-01' }), birthday(), today)).toBe('2024-12-01')
  })

  it('without an entry date counts from the planned entry, else from „gilt seit“, else from today', () => {
    expect(docDue(child({ birthDate: '2022-12-01', entryDate: null, plannedEntryDate: '2027-01-01', since: today }), birthday(), today))
      .toBe('2027-12-01')
    expect(docDue(child({ birthDate: '2022-12-01', entryDate: null, since: today }), birthday(), today)).toBe('2026-12-01')
    expect(docDue(child({ birthDate: '2022-12-01', entryDate: null }), birthday(), today)).toBe('2026-12-01')
  })

  it('without a done date a passed birthday stays overdue: the due day does not move with today', () => {
    const lena = child({ birthDate: '2022-10-19', since: '2026-10-01' })
    expect(docDue(lena, birthday(), '2026-10-19')).toBe('2026-10-19')
    expect(inWindow(docDue(lena, birthday(), '2026-10-20')!, 14, '2026-10-20')).toBe('overdue')
    expect(docDue(lena, birthday(), '2026-11-20')).toBe('2026-10-19')
    expect(inWindow(docDue(lena, birthday(), '2026-11-20')!, 14, '2026-11-20')).toBe('overdue')
  })

  it('switching on today does not make a long-enrolled child overdue', () => {
    const old = child({ birthDate: '2020-03-15', entryDate: '2021-09-01', since: today })
    expect(docDue(old, birthday(), today)).toBe('2027-03-15')
    expect(inWindow(docDue(old, birthday(), today)!, 14, today)).toBe('before')
  })

  it('with a done date is the next birthday strictly after it (done well before the window)', () => {
    expect(docDue(child({ birthDate: '2022-12-01', lastDone: '2025-12-02' }), birthday(2), today)).toBe('2026-12-01')
    expect(docDue(child({ birthDate: '2022-12-01', lastDone: '2026-01-10' }), birthday(2), today)).toBe('2026-12-01')
  })

  it('a done date on the birthday itself counts for that birthday', () => {
    expect(docDue(child({ birthDate: '2022-12-01', lastDone: '2026-12-01' }), birthday(2), '2026-12-02')).toBe('2027-12-01')
  })

  it('a done date inside the lead window counts for the coming birthday (review focus 2)', () => {
    const settings = birthday(2)
    // window of 1 Dec 2026 starts 17 Nov 2026
    const done = '2026-11-20'
    expect(docDue(child({ birthDate: '2022-12-01', lastDone: done }), settings, '2026-11-20')).toBe('2027-12-01')
    // birthday passes: still no reminder until next year's window
    expect(docDue(child({ birthDate: '2022-12-01', lastDone: done }), settings, '2026-12-02')).toBe('2027-12-01')
    const due = docDue(child({ birthDate: '2022-12-01', lastDone: done }), settings, '2026-12-02')!
    expect(inWindow(due, 14, '2026-12-02')).toBe('before')
    expect(inWindow(due, 14, '2027-11-17')).toBe('upcoming')
  })

  it('a done date on the first day of the lead window counts, one day earlier does not', () => {
    const settings = birthday(2)
    expect(docDue(child({ birthDate: '2022-12-01', lastDone: '2026-11-17' }), settings, '2026-11-18')).toBe('2027-12-01')
    expect(docDue(child({ birthDate: '2022-12-01', lastDone: '2026-11-16' }), settings, '2026-11-18')).toBe('2026-12-01')
  })

  it('with a lead of 0 weeks only a done date on the birthday counts for it', () => {
    expect(docDue(child({ birthDate: '2022-12-01', lastDone: '2026-11-30' }), birthday(0), '2026-11-30')).toBe('2026-12-01')
  })

  it('a stale done date leaves the passed birthday overdue', () => {
    expect(docDue(child({ birthDate: '2022-03-15', lastDone: '2025-06-01' }), birthday(2), today)).toBe('2026-03-15')
  })

  it('a 29 February child has the birthday on 28 February in non-leap years and 29 February in leap years', () => {
    expect(docDue(child({ birthDate: '2024-02-29', since: '2026-10-19' }), birthday(), '2026-10-19')).toBe('2027-02-28')
    expect(docDue(child({ birthDate: '2024-02-29', since: '2027-10-19' }), birthday(), '2027-10-19')).toBe('2028-02-29')
  })
})

describe('nextBirthday', () => {
  it('is the next occurrence on or after today', () => {
    expect(nextBirthday('12-01', '2026-10-19')).toBe('2026-12-01')
    expect(nextBirthday('10-19', '2026-10-19')).toBe('2026-10-19')
    expect(nextBirthday('10-18', '2026-10-19')).toBe('2027-10-18')
  })

  it('moves 29 February to 28 February in a non-leap year (2027) and keeps it in a leap year (2028)', () => {
    expect(nextBirthday('02-29', '2026-10-19')).toBe('2027-02-28')
    expect(nextBirthday('02-29', '2027-03-01')).toBe('2028-02-29')
    expect(nextBirthday('02-29', '2028-02-29')).toBe('2028-02-29')
    expect(nextBirthday('02-29', '2028-03-01')).toBe('2029-02-28')
  })
})

describe('inWindow', () => {
  const due = '2026-11-10'

  it('is before until the day before the lead window', () => {
    expect(inWindow(due, 14, '2026-10-26')).toBe('before')
  })

  it('is upcoming from due minus lead up to the day before', () => {
    expect(inWindow(due, 14, '2026-10-27')).toBe('upcoming')
    expect(inWindow(due, 14, '2026-11-09')).toBe('upcoming')
  })

  it('is today on the due day, even with a lead of 0', () => {
    expect(inWindow(due, 14, '2026-11-10')).toBe('today')
    expect(inWindow(due, 0, '2026-11-10')).toBe('today')
    expect(inWindow(due, 0, '2026-11-09')).toBe('before')
  })

  it('is overdue after the due day', () => {
    expect(inWindow(due, 14, '2026-11-11')).toBe('overdue')
  })
})

describe('sortReminders', () => {
  interface Item { kind: ReminderKind; date: string; state: 'upcoming' | 'today' | 'overdue'; name: string }
  const item = (kind: Item['kind'], date: string, state: Item['state'], name: string): Item => ({ kind, date, state, name })

  it('puts overdue first, then today, then upcoming by date', () => {
    const sorted = sortReminders([
      item('doc', '2026-11-05', 'upcoming', 'A'),
      item('doc', '2026-10-19', 'today', 'B'),
      item('birthday', '2026-10-15', 'overdue', 'C'),
      item('doc', '2026-10-25', 'upcoming', 'D'),
    ])
    expect(sorted.map((entry) => entry.name)).toEqual(['C', 'B', 'D', 'A'])
  })

  it('breaks ties by kind (doc, meeting, birthday, staff birthday, leaving), then name', () => {
    const sorted = sortReminders([
      item('leaving', '2026-10-25', 'upcoming', 'A'),
      item('meeting', '2026-10-25', 'upcoming', 'M'),
      item('staffBirthday', '2026-10-25', 'upcoming', 'A'),
      item('birthday', '2026-10-25', 'upcoming', 'Zoe'),
      item('birthday', '2026-10-25', 'upcoming', 'Ali'),
      item('doc', '2026-10-25', 'upcoming', 'Z'),
    ])
    expect(sorted.map((entry) => `${entry.kind}:${entry.name}`)).toEqual([
      'doc:Z', 'meeting:M', 'birthday:Ali', 'birthday:Zoe', 'staffBirthday:A', 'leaving:A',
    ])
  })

  it('orders the meetings of a day by time before the name', () => {
    const sorted = sortReminders([
      { ...item('meeting', '2026-10-25', 'today', 'Ali'), time: 840 },
      { ...item('meeting', '2026-10-25', 'today', 'Zoe'), time: 480 },
      { ...item('meeting', '2026-10-25', 'today', 'Ben'), time: 840 },
    ])
    expect(sorted.map((entry) => entry.name)).toEqual(['Zoe', 'Ali', 'Ben'])
  })

  it('sorts overdue items by date, oldest first, and does not mutate the input', () => {
    const input = [
      item('doc', '2026-10-18', 'overdue', 'A'),
      item('doc', '2026-10-01', 'overdue', 'B'),
    ]
    const sorted = sortReminders(input)
    expect(sorted.map((entry) => entry.name)).toEqual(['B', 'A'])
    expect(input.map((entry) => entry.name)).toEqual(['A', 'B'])
  })
})
