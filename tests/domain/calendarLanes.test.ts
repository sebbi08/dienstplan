import { describe, expect, it } from 'vitest'
import type { CalendarEventDto } from '../../shared/types/api'
import { calendarLanes } from '../../app/utils/calendarLanes'

const dates = Array.from({ length: 30 }, (_, index) => `2026-11-${String(index + 1).padStart(2, '0')}`)
const event = (id: number, date: string, title: string): CalendarEventDto =>
  ({ id, date, start: null, end: null, title, visibleToStaff: true })
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
})
