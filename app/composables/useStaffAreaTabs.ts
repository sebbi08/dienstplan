import { staffAreaTabs } from '~/utils/areaTabs'

/**
 * The tab bar of Mitarbeitende (list, Bewerbungen & Hospitationen, Krankheitstage, Unterschriften, Unfälle) for the
 * account, with the overdue requests to sign counted at „Unterschriften“ (loaded by the layout for the menu).
 */
export function useStaffAreaTabs() {
  const { can } = useCan()
  const { data: signOverdue } = useNuxtData<{ count: number }>('sign-overdue-count')
  return computed(() => staffAreaTabs(can, { signOverdue: signOverdue.value?.count ?? 0 }))
}
