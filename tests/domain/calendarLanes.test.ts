import { describe, expect, it } from 'vitest'
import type { CalendarEventDto } from '../../shared/types/api'
import { calendarEventText, calendarLanes, eventDayText, eventListTimeText, eventsInDays } from '../../app/utils/calendarLanes'

const dates = Array.from({ length: 30 }, (_, index) => `2026-11-${String(index + 1).padStart(2, '0')}`)
const event = (id: number, date: string, title: string): CalendarEventDto =>
  ({ id, date, start: null, end: null, title, endDate: null, visibility: 'all', groupIds: [], employeeIds: [] })
const eventText = (item: CalendarEventDto) => `${Number(item.date.slice(8))}. ${item.title}`

describe('calendarLanes', () => {
  it('places the own appointments of a day before its automatic events, one lane each', () => {
    const { labels, laneCount } = calendarLanes(
      dates, [event(1, '2026-11-03', 'Elternabend')], eventText,
      { '2026-11-03': ['Kindergeburtstag (Bären)', 'Geburtstag Anna'] },
    )
    expect(labels.map(label => [label.text, label.lane, label.item.kind])).toEqual([
      ['3. Elternabend', 0, 'event'],
      ['3. Kindergeburtstag (Bären)', 1, 'auto'],
      ['3. Geburtstag Anna', 2, 'auto'],
    ])
    expect(laneCount).toBe(3)
  })

  it('reuses a lane once the earlier text has ended and cuts a text where the next one of its lane begins', () => {
    const { labels, laneCount } = calendarLanes(dates, [], eventText, {
      '2026-11-02': ['Eingewöhnung (Mäuse)'], // 23 chars + icon: 6 days, lane 0 is free again from the 8th
      '2026-11-04': ['Geburtstag Ben'],
      '2026-11-08': ['Geburtstag Cem'],
    })
    expect(labels.map(label => [label.start, label.lane, label.width])).toEqual([[1, 0, 6], [3, 1, 27], [7, 0, 23]])
    expect(laneCount).toBe(2)
  })

  it('has no lanes without appointments or events', () => {
    expect(calendarLanes(dates, [], eventText, {})).toEqual({ labels: [], laneCount: 0 })
  })

  it('keeps an appointment over several days in its lane on all its days, also one that began the month before', () => {
    const long = { ...event(1, '2026-10-30', 'Fortbildung'), endDate: '2026-11-03' }
    const short = { ...event(2, '2026-11-02', 'Team') }
    const shown = eventsInDays([long, short, event(3, '2026-10-29', 'vorher')], dates)
    expect(shown.map(item => item.id)).toEqual([1, 2])
    const { labels } = calendarLanes(dates, shown, calendarEventText, {})
    expect(labels.map(label => [label.text, label.start, label.days, label.lane])).toEqual([
      ['30.10.–3.11. Fortbildung', 0, 3, 0], ['2. Team', 1, 1, 1],
    ])
  })
})

describe('appointment texts', () => {
  const course = { ...event(1, '2026-03-10', 'Fortbildungstage'), endDate: '2026-03-12', start: 540, end: 960 }
  it('writes a longer appointment with its days, the start on its first and the end on its last day', () => {
    expect(calendarEventText(course)).toBe('10.–12.3. Fortbildungstage')
    expect(eventDayText(course, '2026-03-10')).toBe('Fortbildungstage 10.–12.3. ab 9:00')
    expect(eventDayText(course, '2026-03-11')).toBe('Fortbildungstage 10.–12.3.')
    expect(eventDayText(course, '2026-03-12')).toBe('Fortbildungstage 10.–12.3. bis 16:00')
    expect(eventListTimeText(course)).toBe('Beginn 9:00 · Ende 16:00')
  })
  it('writes a one-day appointment with its time', () => {
    const evening = { ...event(2, '2026-10-14', 'Elternabend'), start: 1140, end: 1260 }
    expect(eventDayText(evening, '2026-10-14')).toBe('Elternabend 19:00–21:00')
    expect(eventListTimeText(evening)).toBe('19:00–21:00')
    expect(eventDayText(event(3, '2026-10-14', 'Teamtag'), '2026-10-14')).toBe('Teamtag')
  })
})
