const UMLAUTS: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss' }

/**
 * The download name of a printout's PDF (plan, year calendar): its parts joined by „-“ (empty parts left out, umlauts
 * spelled out), with „-intern“ at the end when „Interne Termine mitdrucken“ is ticked – so a printout with internal
 * appointments is never mixed up with the one to hang up. PrintActions makes the rest of the name safe.
 */
export function printFileName(parts: readonly (string | number | null | undefined)[], internal: boolean): string {
  return [...parts, internal ? 'intern' : null]
    .filter(part => part !== null && part !== undefined && part !== '')
    .map(part => String(part).replace(/[äöüÄÖÜß]/g, letter => UMLAUTS[letter]!))
    .join('-')
}
