/**
 * One button of a list row (RowActions.vue): a label and an icon, and either a link (`to`) or a click handler. `show:
 * false` leaves it out (e.g. a right the viewer lacks); `iconOnly` shows the button with its icon alone (the label then
 * is its name for screen readers and its tooltip; in the „⋯“ menu it is always written out).
 */
export interface RowAction {
  key: string
  label: string
  icon: string
  onClick?: () => unknown
  to?: string
  target?: string
  external?: boolean
  color?: 'neutral' | 'error'
  variant?: 'outline' | 'ghost'
  disabled?: boolean
  /** The tooltip, when it should say more than the label (e.g. why the button is disabled). */
  title?: string
  iconOnly?: boolean
  show?: boolean
}

/**
 * The row's buttons split for phones: the first shown one stays a button (the main action, e.g. „Öffnen“), the others
 * go into the „⋯“ menu. From 640 px all of them show in a row.
 */
export interface RowMenuItem {
  label: string
  icon: string
  color?: 'error'
  disabled?: boolean
  /** Why it is disabled (the desktop tooltip), written below the label: phones have no tooltip. */
  description?: string
  to?: string
  target?: string
  external?: boolean
  onSelect?: () => void
}

/** An action as an entry of the „⋯“ menu (Nuxt UI DropdownMenu item). */
export function rowMenuItem(action: RowAction): RowMenuItem {
  return {
    label: action.label, icon: action.icon,
    ...(action.color === 'error' ? { color: 'error' as const } : {}),
    ...(action.disabled ? { disabled: true, ...(action.title ? { description: action.title } : {}) } : {}),
    ...(action.to ? { to: action.to, target: action.target, external: action.external } : {}),
    ...(action.onClick ? { onSelect: () => { action.onClick!() } } : {}),
  }
}

export function rowActionSplit(actions: readonly RowAction[]): { primary: RowAction | null; rest: RowAction[] } {
  const shown = actions.filter(action => action.show !== false)
  return { primary: shown[0] ?? null, rest: shown.slice(1) }
}
