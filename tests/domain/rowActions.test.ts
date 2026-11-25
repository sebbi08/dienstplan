import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { rowActionSplit, type RowAction } from '../../app/utils/rowActions'

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

  it('shows ▲/▼ in the Dokumente lists only after „Reihenfolge ändern“', () => {
    const file = (path: string) => readFileSync(join(process.cwd(), 'app', 'components', path), 'utf8')
    expect(file('templates/Library.vue')).toContain('v-if="canEdit && reordering" role="group"')
    expect(file('knowledge/Library.vue')).toContain('v-if="section.group && reordering" role="group"')
    expect(file('forms/TemplateLibrary.vue')).toContain('v-if="reordering" role="group"')
    for (const path of ['templates/Library.vue', 'knowledge/Library.vue', 'forms/TemplateLibrary.vue']) {
      expect(file(path), path).toContain('de.common.reorder')
      expect(file(path), path).toContain('<RowActions')
    }
  })
})
