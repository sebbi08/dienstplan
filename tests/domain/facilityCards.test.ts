import { describe, expect, it } from 'vitest'
import {
  FACILITY_CARDS_KEY, cardDetails, isCardOpen, readCardState, toggledCardState, writeCardState,
} from '../../app/utils/facilityCards'
import { de } from '../../app/locales/de'
import { errorMessage } from '../../app/utils/errors'
import { pairedWith } from '../../app/utils/helpoutPairs'

/** A storage holding the given text under the key (or throwing, like a blocked one). */
const storageWith = (text: string | null) => ({ getItem: (key: string) => (key === FACILITY_CARDS_KEY ? text : null) })

describe('facility cards under Einstellungen → Einrichtung', () => {
  it('opens only the facility chosen in „Einstellungen für“ until the user opens or closes cards', () => {
    expect([isCardOpen({}, 1, 1), isCardOpen({}, 2, 1), isCardOpen({}, 2, null)]).toEqual([true, false, false])
    let state = toggledCardState({}, 2, 1)
    expect(state).toEqual({ 2: true })
    state = toggledCardState(state, 1, 1)
    expect([isCardOpen(state, 1, 1), isCardOpen(state, 2, 1), isCardOpen(state, 3, 1)]).toEqual([false, true, false])
    // Another facility chosen later: a card the user closed stays closed, an untouched one follows the choice.
    expect([isCardOpen(state, 1, 3), isCardOpen(state, 3, 3)]).toEqual([false, true])
  })

  it('keeps the state per device and survives broken or blocked storage', () => {
    const stored: Record<string, string> = {}
    writeCardState({ setItem: (key, value) => { stored[key] = value } }, { 2: true, 5: false })
    expect(readCardState(storageWith(stored[FACILITY_CARDS_KEY]!))).toEqual({ 2: true, 5: false })
    for (const text of [null, '', 'kaputt', '[true]', '"x"', '{"a":true,"0":true,"3":"ja","4":false}']) {
      expect(readCardState(storageWith(text)), String(text)).toEqual(text?.startsWith('{"a"') ? { 4: false } : {})
    }
    expect(readCardState({ getItem: () => { throw new Error('blocked') } })).toEqual({})
    expect(readCardState(null)).toEqual({})
    expect(() => writeCardState({ setItem: () => { throw new Error('quota') } }, { 1: true })).not.toThrow()
  })

  it('names the Bundesland and the number of groups in the header', () => {
    const groups = de.facilities.groupCount
    expect(cardDetails('Baden-Württemberg', 3, groups)).toBe('Baden-Württemberg · 3 Gruppen')
    expect(cardDetails('Bayern', 1, groups)).toBe('Bayern · 1 Gruppe')
    expect(cardDetails('Bayern', 0, groups)).toBe('Bayern · keine Gruppen')
    expect(cardDetails('Hessen', null, groups)).toBe('Hessen')
    expect(de.settingsAreas.settingsForChosen('Kita Sonnenschein')).toBe('Einstellungen für Kita Sonnenschein')
  })

  it('reads the help-out pairs of a facility from either side and names the facility a refusal names', () => {
    const pairs = { pairs: [[1, 2], [2, 3]] as [number, number][], names: {}, unpaired: [] }
    expect([...pairedWith(pairs, 2)].sort()).toEqual([1, 3])
    expect([...pairedWith(pairs, 1)]).toEqual([2])
    expect([...pairedWith(null, 1)]).toEqual([])
    const refusal = (details?: unknown) => ({ data: { data: { code: 'help_out_not_paired', details } } })
    expect(errorMessage(refusal({ facility: 'Krippe' }))).toBe('Aushilfe aus Krippe ist nicht freigegeben.')
    expect(errorMessage(refusal())).toBe('Aushilfe aus dieser Einrichtung ist nicht freigegeben.')
  })
})
