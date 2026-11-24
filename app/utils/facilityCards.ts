/**
 * Einstellungen → Einrichtung shows every facility as a card that opens and closes. Which cards are open is kept per
 * device (localStorage, never required: private windows or blocked storage just start with the defaults); without a
 * stored choice only the facility chosen in „Einstellungen für“ is open.
 */
export const FACILITY_CARDS_KEY = 'settings-facility-cards'

/** Open (true) or closed (false) per facility id, as the user left them on this device. */
export type CardState = Record<number, boolean>

/** The stored state; anything unreadable or malformed counts as nothing stored. */
export function readCardState(storage: Pick<Storage, 'getItem'> | null | undefined): CardState {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(FACILITY_CARDS_KEY) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const state: CardState = {}
    for (const [key, value] of Object.entries(parsed)) {
      const id = Number(key)
      if (Number.isInteger(id) && id > 0 && typeof value === 'boolean') state[id] = value
    }
    return state
  }
  catch {
    return {}
  }
}

/** Stores the state (silently skipped when the storage refuses). */
export function writeCardState(storage: Pick<Storage, 'setItem'> | null | undefined, state: CardState): void {
  try {
    storage?.setItem(FACILITY_CARDS_KEY, JSON.stringify(state))
  }
  catch {
    // Private window or blocked storage: the cards just open as by default next time.
  }
}

/** Whether the facility's card is open: as stored, otherwise only the facility chosen in „Einstellungen für“. */
export const isCardOpen = (state: CardState, facilityId: number, chosenId: number | null): boolean =>
  state[facilityId] ?? facilityId === chosenId

/** The state after opening or closing one card (the others keep what they show now, also their default). */
export function toggledCardState(state: CardState, facilityId: number, chosenId: number | null): CardState {
  return { ...state, [facilityId]: !isCardOpen(state, facilityId, chosenId) }
}

/** The details after the name in a card's header: „Baden-Württemberg · 3 Gruppen“ (the count left out while unknown). */
export function cardDetails(stateName: string, groupCount: number | null, groupText: (count: number) => string): string {
  return [stateName, groupCount === null ? '' : groupText(groupCount)].filter(part => part !== '').join(' · ')
}
