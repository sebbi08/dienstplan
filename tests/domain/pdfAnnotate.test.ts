import { describe, expect, it } from 'vitest'
import {
  annotateTools, createPdfjsL10n, createTapTracker, editorModeFor, isEditorLayer, isEditorManager, isTypingTarget, tolerant, fontSizeName, MARK_LINES, nextEditorState, nextZoom, pdfjsTexts,
  shouldRefit, stampSize, strokeBounds, TAP_SLOP, ZOOMS,
} from '../../app/utils/pdfAnnotate'

const MODES = { NONE: 0, FREETEXT: 3, STAMP: 13 }

describe('filling any PDF: the tools of the fill view', () => {
  it('offers „Felder“ only for a PDF with form fields, the other tools always', () => {
    expect(annotateTools(true)).toEqual(['fields', 'select', 'text', 'check', 'cross', 'signature'])
    expect(annotateTools(false)).toEqual(['select', 'text', 'check', 'cross', 'signature'])
  })

  it('maps each tool to a pdf.js editor mode (fields: none; text: FreeText; pictures and choosing: stamp)', () => {
    expect(editorModeFor('fields', MODES)).toBe(0)
    expect(editorModeFor('text', MODES)).toBe(3)
    for (const tool of ['select', 'check', 'cross', 'signature'] as const) expect(editorModeFor(tool, MODES)).toBe(13)
  })

  it('names the nearest font size of a text box', () => {
    expect(fontSizeName(8)).toBe('small')
    expect(fontSizeName(10)).toBe('normal')
    expect(fontSizeName(11)).toBe('normal')
    expect(fontSizeName(14)).toBe('large')
    expect(fontSizeName(40)).toBe('large')
    expect(fontSizeName(2)).toBe('small')
  })

  it('steps the zoom from any value to the next step, and stops at the ends', () => {
    expect(nextZoom(1, 1)).toBe(1.25)
    expect(nextZoom(1, -1)).toBe(0.75)
    expect(nextZoom(1.1, 1)).toBe(1.25)
    expect(nextZoom(1.1, -1)).toBe(1)
    expect(nextZoom(1.249, 1)).toBe(1.5)
    expect(nextZoom(ZOOMS[ZOOMS.length - 1]!, 1)).toBe(3)
    expect(nextZoom(0.5, -1)).toBe(0.5)
    expect(nextZoom(0.2, 1)).toBe(0.5)
  })

  it('sizes a picture on the page within its box, keeping its proportions (shares of the page)', () => {
    const page = { width: 595, height: 842 }
    // A square tick of 96 px as 14 pt.
    expect(stampSize({ width: 96, height: 96 }, page, { width: 14, height: 14 })).toEqual({ width: 14 / 595, height: 14 / 842 })
    // A wide signature: limited by the width.
    const wide = stampSize({ width: 1000, height: 250 }, page, { width: 170, height: 60 })
    expect(wide.width * page.width).toBeCloseTo(170)
    expect(wide.height * page.height).toBeCloseTo(42.5)
    // A tall one: limited by the height.
    const tall = stampSize({ width: 300, height: 300 }, page, { width: 170, height: 60 })
    expect(tall.width * page.width).toBeCloseTo(60)
    expect(tall.height * page.height).toBeCloseTo(60)
  })

  it('finds the area of the drawn signature with a margin, inside the pad', () => {
    expect(strokeBounds([], 10, { width: 600, height: 200 })).toBeNull()
    expect(strokeBounds([[]], 10, { width: 600, height: 200 })).toBeNull()
    expect(strokeBounds([[{ x: 50, y: 40 }, { x: 120, y: 90 }], [{ x: 200, y: 60 }]], 10, { width: 600, height: 200 }))
      .toEqual({ x: 40, y: 30, width: 170, height: 70 })
    // At the edge: clamped to the pad.
    expect(strokeBounds([[{ x: 2, y: 195 }, { x: 598, y: 3 }]], 10, { width: 600, height: 200 }))
      .toEqual({ x: 0, y: 0, width: 600, height: 200 })
    // A single dot still has a size.
    expect(strokeBounds([[{ x: 0, y: 0 }]], 0, { width: 600, height: 200 })).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })

  it('draws the tick as one line and the cross as two, inside the square', () => {
    expect(MARK_LINES.check).toHaveLength(1)
    expect(MARK_LINES.cross).toHaveLength(2)
    for (const point of [...MARK_LINES.check.flat(), ...MARK_LINES.cross.flat()]) {
      expect(Math.min(...point)).toBeGreaterThanOrEqual(0)
      expect(Math.max(...point)).toBeLessThanOrEqual(1)
    }
  })

  it('places a mark only for a tap with one finger on the free page, not when pinching, dragging or scrolling', () => {
    const taps = createTapTracker()
    taps.press(1, { x: 100, y: 100 }, true)
    expect(taps.release(1, { x: 104, y: 103 })).toEqual({ x: 100, y: 100 })
    // Moved too far: a drag.
    taps.press(2, { x: 100, y: 100 }, true)
    expect(taps.release(2, { x: 100, y: 100 + TAP_SLOP + 1 })).toBeNull()
    // Pressed on something added (it gets selected instead).
    taps.press(3, { x: 100, y: 100 }, false)
    expect(taps.release(3, { x: 100, y: 100 })).toBeNull()
    // Pinching: two fingers; neither lifting places anything, and the next tap works again.
    taps.press(4, { x: 100, y: 100 }, true)
    taps.press(5, { x: 200, y: 100 }, true)
    expect(taps.release(5, { x: 220, y: 100 })).toBeNull()
    expect(taps.release(4, { x: 100, y: 100 })).toBeNull()
    taps.press(6, { x: 50, y: 50 }, true)
    expect(taps.release(6, { x: 50, y: 50 })).toEqual({ x: 50, y: 50 })
    // Scrolling: the browser cancels the pointer.
    taps.press(7, { x: 50, y: 50 }, true)
    taps.cancel(7)
    expect(taps.release(7, { x: 50, y: 50 })).toBeNull()
    // One finger of a pinch cancelled, the other lifted: no tap.
    taps.press(8, { x: 50, y: 50 }, true)
    taps.press(9, { x: 90, y: 50 }, true)
    taps.cancel(9)
    expect(taps.release(8, { x: 50, y: 50 })).toBeNull()
    taps.press(10, { x: 10, y: 10 }, true)
    expect(taps.release(10, { x: 10, y: 10 })).toEqual({ x: 10, y: 10 })
  })

  it('checks what pdf.js hands over before the tools use it (another pdf.js version may differ)', () => {
    const fn = () => {}
    expect(isEditorManager({ getLayer: fn, undo: fn, delete: fn, commitOrRemove: fn, updateParams: fn })).toBe(true)
    expect(isEditorManager({ getLayer: fn, undo: fn, delete: fn, commitOrRemove: fn })).toBe(false)
    expect(isEditorManager(null)).toBe(false)
    const layer = { createAndAddNewEditor: fn, pageDimensions: [595, 842], div: {}, viewport: { rotation: 0 } }
    expect(isEditorLayer(layer)).toBe(true)
    expect(isEditorLayer({ ...layer, pageDimensions: undefined })).toBe(false)
    expect(isEditorLayer({ ...layer, createAndAddNewEditor: undefined })).toBe(false)
    expect(isEditorLayer(undefined)).toBe(false)
  })

  it('answers unknown calls on the translations quietly, and is no promise', async () => {
    const l10n = tolerant({ getLanguage: () => 'de' }) as Record<string, unknown> & { getLanguage: () => string }
    expect(l10n.getLanguage()).toBe('de')
    await expect((l10n.somethingNew as () => Promise<unknown>)()).resolves.toBeUndefined()
    expect(l10n.then).toBeUndefined()
    expect(await Promise.resolve(l10n)).toBe(l10n)
    expect(typeof (createPdfjsL10n() as unknown as Record<string, unknown>).newerMethod).toBe('function')
  })

  it('keeps the bar state from the editor events (pdf.js sends only what changed)', () => {
    let state = { canUndo: false, hasSelection: false }
    state = nextEditorState(state, { hasSomethingToUndo: true })
    expect(state).toEqual({ canUndo: true, hasSelection: false })
    state = nextEditorState(state, { hasSelectedEditor: true })
    expect(state).toEqual({ canUndo: true, hasSelection: true })
    state = nextEditorState(state, {})
    expect(state).toEqual({ canUndo: true, hasSelection: true })
    state = nextEditorState(state, { hasSomethingToUndo: false, hasSelectedEditor: false })
    expect(state).toEqual({ canUndo: false, hasSelection: false })
  })

  it('fits the pages again only when the view got wider or narrower, never while typing (the keyboard stays open)', () => {
    // The on-screen keyboard (or a browser bar) changes only the height: no refit, which would end the text box.
    expect(shouldRefit({ width: 800, fittedWidth: 800, typing: false })).toBe(false)
    expect(shouldRefit({ width: 800.4, fittedWidth: 800, typing: false })).toBe(false)
    // A turned tablet, a resized window, a scroll bar that came or went: fitted again.
    expect(shouldRefit({ width: 1280, fittedWidth: 800, typing: false })).toBe(true)
    expect(shouldRefit({ width: 785, fittedWidth: 800, typing: false })).toBe(true)
    expect(shouldRefit({ width: 800, fittedWidth: null, typing: false })).toBe(true)
    // While a text box or a field is typed in nothing is refitted (fitted at the next resize after typing).
    expect(shouldRefit({ width: 1280, fittedWidth: 800, typing: true })).toBe(false)
    expect(shouldRefit({ width: 800, fittedWidth: null, typing: true })).toBe(false)
  })

  it('counts text boxes and form fields as typing, not the page or a picture', () => {
    expect(isTypingTarget({ isContentEditable: true, tagName: 'DIV' })).toBe(true)
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) expect(isTypingTarget({ isContentEditable: false, tagName }), tagName).toBe(true)
    expect(isTypingTarget({ isContentEditable: false, tagName: 'DIV' })).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })

  it('gives pdf.js German labels for what the fill view shows', async () => {
    expect(pdfjsTexts('pdfjs-editor-remove-stamp-button')).toEqual({ 'title': 'Löschen', 'aria-label': 'Löschen' })
    expect(pdfjsTexts('pdfjs-editor-remove-freetext-button')).toEqual({ 'title': 'Löschen', 'aria-label': 'Löschen' })
    expect(pdfjsTexts('pdfjs-editor-resizer-top-left')).toEqual({ 'aria-label': 'Größe ändern' })
    expect(pdfjsTexts('pdfjs-free-text2')).toEqual({ 'aria-label': 'Text', 'default-content': 'Text eingeben …' })
    expect(pdfjsTexts('pdfjs-page-landmark', { page: 3 })).toEqual({ 'aria-label': 'Seite 3' })
    expect(pdfjsTexts('pdfjs-editor-alt-text-button')).toBeNull()
    const l10n = createPdfjsL10n()
    expect(l10n.getLanguage()).toBe('de')
    expect(await l10n.get('pdfjs-editor-remove-ink-button')).toBe('Löschen')
    expect(await l10n.get('pdfjs-unknown', null, 'fallback')).toBe('fallback')
    expect(await l10n.get(['pdfjs-editor-resizer-top-left', 'pdfjs-unknown'])).toEqual(['Größe ändern', ''])
  })
})
