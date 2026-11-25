import { describe, expect, it, vi } from 'vitest'
import { rowActionSplit, rowMenuItem, type RowAction } from '../../app/utils/rowActions'

const action = (key: string, show?: boolean): RowAction => ({ key, label: key, icon: 'i-lucide-circle', ...(show === undefined ? {} : { show }) })

describe('the buttons of a list row on phones (one button and „⋯“)', () => {
  it('keeps the first shown action as the button and puts the others into the menu', () => {
    const split = rowActionSplit([action('open'), action('fill'), action('send', false), action('edit'), action('delete')])
    expect(split.primary?.key).toBe('open')
    expect(split.rest.map(entry => entry.key)).toEqual(['fill', 'edit', 'delete'])
  })

  it('moves up the next action when the first is hidden, and has no menu for a single action', () => {
    expect(rowActionSplit([action('edit', false), action('confirmed'), action('delete', false)]))
      .toEqual({ primary: action('confirmed'), rest: [] })
    expect(rowActionSplit([action('edit', false)])).toEqual({ primary: null, rest: [] })
  })

  it('writes the reason of a disabled action into its menu entry (phones have no tooltip)', () => {
    const onClick = vi.fn()
    const inUse = rowMenuItem({ key: 'delete', label: 'Löschen', icon: 'i-lucide-trash-2', color: 'error', disabled: true, title: 'Schon benutzt', onClick })
    expect(inUse).toMatchObject({ label: 'Löschen', color: 'error', disabled: true, description: 'Schon benutzt' })
    // An enabled action keeps its tooltip off the menu and runs its handler.
    const copy = rowMenuItem({ key: 'copy', label: 'Kopieren', icon: 'i-lucide-copy', title: 'Kopieren', onClick })
    expect(copy).not.toHaveProperty('description')
    expect(copy).not.toHaveProperty('disabled')
    copy.onSelect!()
    expect(onClick).toHaveBeenCalledOnce()
    // A link stays a link (e.g. „Leer drucken“ in a new tab).
    expect(rowMenuItem({ key: 'print', label: 'Drucken', icon: 'i-lucide-printer', to: '/x', target: '_blank' }))
      .toEqual({ label: 'Drucken', icon: 'i-lucide-printer', to: '/x', target: '_blank', external: undefined })
  })
})
