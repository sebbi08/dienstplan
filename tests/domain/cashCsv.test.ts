import { describe, expect, it } from 'vitest'
import { monthSheet, type CashEntryFact } from '../../shared/domain/cash'
import { cashCsv } from '../../shared/domain/cashCsv'

const entries: CashEntryFact[] = [
  { id: 1, date: '2026-10-02', direction: 'in', cents: 123456, purpose: 'Elternbeitrag', hasReceipt: true, transferId: null },
  { id: 2, date: '2026-10-05', direction: 'out', cents: 1250, purpose: 'Obst; Gemüse', hasReceipt: false, transferId: null },
  { id: 3, date: '2026-10-07', direction: 'out', cents: 200000, purpose: 'Bastel "Material"\nZeile 2', hasReceipt: true, transferId: 9 },
]

function build() {
  const sheet = monthSheet({
    kind: 'cash', startBalance: 5000, startMonth: { year: 2026, month: 10 }, year: 2026, month: 10, entries,
  })
  return cashCsv({
    boxName: 'Gruppe; "Bären"', from: { year: 2026, month: 10 }, to: { year: 2026, month: 10 },
    opening: sheet.opening, closing: sheet.closing, rows: sheet.rows,
  })
}

describe('cashCsv', () => {
  it('starts with a BOM and uses CRLF line endings', () => {
    const csv = build()
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv.charCodeAt(1)).toBe('K'.charCodeAt(0))
    expect(csv.endsWith('\r\n')).toBe(true)
    expect(csv.replace(/\r\n/g, '').includes('\n')).toBe(true) // only the quoted line break remains
    expect(csv.split('\r\n').some((line) => line.endsWith('\n'))).toBe(false)
  })

  it('writes header lines and columns', () => {
    const lines = build().slice(1).split('\r\n')
    expect(lines.slice(0, 6)).toEqual([
      'Kasse;"Gruppe; ""Bären"""',
      'Zeitraum;01.10.2026 – 31.10.2026',
      'Anfangsbestand;50,00',
      'Endbestand;-727,94',
      '',
      'Datum;Nr.;Art;Betrag;Verwendungszweck;Beleg;Bestand',
    ])
    expect(lines.slice(6, 9)).toEqual([
      '02.10.2026;1;Einnahme;1234,56;Elternbeitrag;ja;1284,56',
      '05.10.2026;1;Ausgabe;12,50;"Obst; Gemüse";nein;1272,06',
      '07.10.2026;2;Ausgabe;2000,00;"Bastel ""Material""\nZeile 2";ja;-727,94',
    ])
    expect(lines[9]).toBe('')
    expect(lines).toHaveLength(10)
  })

  it('guards free text against formulas but keeps amounts numeric', () => {
    const row = (id: number, purpose: string) => ({
      id, date: '2026-10-02', direction: 'out' as const, cents: 100, purpose, hasReceipt: false, transferId: null,
      number: id, balanceAfter: -100 * id,
    })
    const csv = cashCsv({
      boxName: '=Kasse', from: { year: 2026, month: 10 }, to: { year: 2026, month: 10 }, opening: 0, closing: -600,
      rows: [
        row(1, '+5 Kinder Ausflug'), row(2, '- Bastelmaterial'), row(3, '@Einkauf'),
        row(4, '\tTab'), row(5, '=SUMME(A1)'), row(6, 'Obst - Gemüse'),
      ],
    })
    const lines = csv.slice(1).split('\r\n')
    expect(lines[0]).toBe("Kasse;'=Kasse")
    expect(lines[3]).toBe('Endbestand;-6,00')
    expect(lines.slice(6, 12).map((line) => line.split(';')[4])).toEqual([
      "'+5 Kinder Ausflug", "'- Bastelmaterial", "'@Einkauf", "'\tTab", "'=SUMME(A1)", 'Obst - Gemüse',
    ])
    expect(lines[6]!.split(';')[6]).toBe('-1,00')
  })

  it('spans a range of months in the period line', () => {
    const csv = cashCsv({
      boxName: 'EC', from: { year: 2026, month: 1 }, to: { year: 2026, month: 12 }, opening: 0, closing: 0, rows: [],
    })
    expect(csv.split('\r\n')[1]).toBe('Zeitraum;01.01.2026 – 31.12.2026')
  })
})
