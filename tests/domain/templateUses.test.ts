import { describe, expect, it } from 'vitest'
import { templateUseHint } from '../../app/utils/templateUses'

describe('the hint which week template filled a plan week', () => {
  const uses = [
    { templateName: 'Woche B', appliedAt: '2026-10-02T21:30:00.000Z', appliedBy: 'leitung' },
    { templateName: 'Woche A', appliedAt: '2026-10-01T08:05:00.000Z', appliedBy: 'traeger' },
  ]

  it('names the latest template and its day (Berlin time), and lists every use in the title', () => {
    expect(templateUseHint({ templateUses: uses, templateChangedSince: false })).toEqual({
      text: 'Vorlage: Woche B (eingesetzt am 02.10.)',
      title: 'Woche B – 02.10.2026 23:30 von leitung\nWoche A – 01.10.2026 10:05 von traeger',
    })
  })

  it('adds „danach angepasst“ when the week changed since', () => {
    expect(templateUseHint({ templateUses: uses.slice(1), templateChangedSince: true })?.text)
      .toBe('Vorlage: Woche A (eingesetzt am 01.10.) – danach angepasst')
  })

  it('says nothing for a week without uses', () => {
    expect(templateUseHint({ templateUses: [], templateChangedSince: false })).toBeNull()
  })
})
