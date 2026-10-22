import type { GermanState } from '../states'
import type { IsoDate, Minutes } from '../types'

/**
 * Staffing ratio ("Personalschlüssel") rules of one federal state, as plain data.
 * The engine (calc.ts, presence.ts) is generic: every state difference lives here.
 * FTE are plain decimals; nothing is rounded before display.
 */

export const QUALIFICATIONS = [
  'fachkraft', 'ergaenzung', 'azubi_1', 'azubi_2', 'azubi_3', 'praktikant', 'none',
] as const

/** An employee's qualification; null in inputs = not entered yet. */
export type Qualification = typeof QUALIFICATIONS[number]

/** `u3` under 3 years, `ue3` 3 years to school start, `school` from school start. */
export type AgeBand = 'u3' | 'ue3' | 'school'

export type StaffingMethod = 'fte_per_child' | 'child_hours' | 'group_fte' | 'group_pauschale'

export type Confidence = 'high' | 'medium' | 'low'

/**
 * Weekly hours band. Every bound is optional; the names say whether it is inclusive:
 * "über 25 bis 35" = { over: 25, upTo: 35 }, "ab 45" = { atLeast: 45 }, "unter 45" = { below: 45 }.
 */
export interface HoursBand {
  over?: number
  atLeast?: number
  upTo?: number
  below?: number
}

/**
 * One demand row. Conditions select the row (first matching row wins, so list special rows first);
 * the method of the rule set decides which value fields are read.
 */
export interface DemandRule {
  // --- conditions ---
  /** Group type key (see StaffingRuleSet.groupTypes); missing = any group. */
  groupType?: string
  /** Per-child methods: the child's age band; missing = any. */
  ageBand?: AgeBand
  /**
   * Per-child methods: finer age in months on the reference day (BE under 2, TH under 1, RP under 2).
   * A row with this condition never matches a child without `ageMonths`.
   */
  ageMonths?: { atLeast?: number; below?: number }
  /** Per-child methods: the child's weekly hours (BE/HE/BB/NW bands). */
  weeklyHours?: HoursBand
  /** group_fte: the row applies only if at least one child of the group is in this band (BW "mit U3"). */
  withAgeBand?: AgeBand
  /** group_fte: the row applies only from this many children in the group (NI Krippe ≥ 11). */
  minChildren?: number

  // --- fte_per_child: fte = fteUnits ÷ childrenPerFte × weight (× weeklyHours ÷ refHoursPerWeek) ---
  /** Children per full-time position (BE 2.75, SN 4.5014, BB 4.25, MV 6, TH 12). */
  childrenPerFte?: number
  /** Positions per `childrenPerFte` children (BB 0.8 / 1.0); default 1. */
  fteUnits?: number
  /** Scale linearly with the child's weekly hours against this reference (RP 35 = 7 h × 5, SN 45). */
  refHoursPerWeek?: number

  // --- child_hours: staff hours/week = hours × weight × staffHoursPerChildHour (or ÷ childHoursPerStaffHour) ---
  /** Staff hours per (weighted) child hour (ST 0.187, HE 0.2). */
  staffHoursPerChildHour?: number
  /** Child hours per staff hour (BY 11, SH 4 / 9 / 10). */
  childHoursPerStaffHour?: number
  /** Counted weekly hours instead of the child's own (HE Betreuungsmittelwert 22.5 / 30 / 42.5 / 50). */
  countedWeeklyHours?: number

  // --- per-child weight (fte_per_child, child_hours) ---
  /** Weight of the child (BY U3 2.0, school 1.2); default 1. A higher weight given with the child wins. */
  childWeight?: number

  // --- group_fte: fte = ftePerGroup (× opening hours ÷ refHoursPerDay) ---
  /** Full-time positions per group (BW Regelgruppe 1.8, SL 2.67). */
  ftePerGroup?: number
  /** Reference opening hours per day; the FTE scale proportionally with the actual opening (BW). */
  refHoursPerDay?: number

  // --- group_pauschale: each child carries weeklyHoursPerGroup ÷ referenceChildren ---
  /** Weekly staff hours of a full group of this form and booking (NW Anlage zu § 33). */
  weeklyHoursPerGroup?: { total: number; minFachkraft?: number; leitung?: number }
  /** Number of children the hours of a full group are based on (NW GF I 20, GF II 10, GF III 25). */
  referenceChildren?: number
}

export type AddOnMode = 'pct_of_demand' | 'fte_per_child' | 'hours_per_group' | 'fte_flat' | 'step_table'

/** A surcharge applied after the demand sum (Leitung, Ausfall, Verfügung, supplements). */
export interface AddOn {
  key: string
  /** German label of the line, e.g. "Leitungszeit". */
  label: string
  /** 'group' = per group (requiredFte); 'facility' = once for the facility (facilityAddOns). */
  scope: 'group' | 'facility'
  /** true = part of the required FTE checked against the plan; false = shown only (Leitung). */
  counts: boolean
  mode: AddOnMode
  /** pct_of_demand: percent of the base demand (HE Ausfall 22, Leitung 20; SN 10). */
  pct?: number
  /** fte_per_child: FTE per (matching) child; fte_flat: FTE once (per group or facility). */
  fte?: number
  /** fte_per_child filters. */
  ageBand?: AgeBand
  weeklyHours?: HoursBand
  /** hours_per_group: weekly hours per group (NI Verfügung 7.5, SL Leitung 6). */
  hours?: number
  /** hours_per_group: hours of the first group instead of `hours` (BW Leitung 6 h + 2 h per further group). */
  firstGroupHours?: number
  /** step_table: FTE of the first step whose `upTo` (inclusive, null = no limit) holds the basis value. */
  steps?: { upTo: number | null; fte: number }[]
  /** step_table: the value looked up — the base demand in FTE or the number of children. */
  basis?: 'demand_fte' | 'children'
  /** Lower / upper limit in FTE, applied when the raw value is above 0 (TH min 0.2, max 1.5; HE cap 1.5). */
  minFte?: number
  capFte?: number
}

/** Who must be present per 15-minute slot. Several applicable rules: the strictest need wins. */
export interface PresenceRule {
  /** 'haupt' / 'rand' = only in that phase of the day; 'always' = in every slot. */
  window: 'haupt' | 'rand' | 'always'
  /** Only for these group types; missing = all groups. */
  groupTypes?: string[]
  /** Only from this many children present; default 1 (no children present = nothing needed). */
  minChildren?: number
  minStaff?: number
  minFachkraft?: number
  /** Per started block of `children` (weighted) children: `staff` staff, of them `fachkraft` Fachkräfte. */
  perChildren?: { children: number; staff: number; fachkraft?: number }
  /** Weights for `perChildren` (SH: U3 count double); default 1. */
  childWeights?: Partial<Record<AgeBand, number>>
  /** With at most `maxChildren` present, `minFachkraft` drops to this value (BW: second may be a Zusatzkraft). */
  relaxFachkraft?: { maxChildren: number; minFachkraft: number }
}

/** A qualification quota, e.g. BY ≥ 50 % Fachkräfte, SN ≤ 20 % Assistenz, NW minimum Fachkraft hours. */
export type Quota =
  | {
    key: string
    label: string
    /** min_share: have ≥ pct % of the base; max_share: have ≤ pct % of the base. */
    kind: 'min_share' | 'max_share'
    qualifications: Qualification[]
    pct: number
    /** 'required' = the required FTE; 'planned' = all planned FTE. */
    base: 'required' | 'planned'
  }
  | {
    key: string
    label: string
    /** The Fachkraft FTE demanded by the demand rows themselves (NW minFachkraft). */
    kind: 'demand_minimum'
    qualifications: Qualification[]
  }

export interface StaffingRuleSet {
  land: GermanState
  /** First day this version applies. */
  validFrom: IsoDate
  /** Law and paragraph, e.g. "KiTaVO BW § 1". */
  source: string
  confidence: Confidence
  /** Hint for partial or unverified data. */
  note?: string
  /**
   * false = the state has presence rules only, no period demand (HB): requiredFte is empty and
   * Soll/Ist should be hidden; `method` and `demand` are then ignored. Default true.
   */
  periodCheck?: boolean
  method: StaffingMethod
  /** Weekly hours of one full-time position (default 39, BE 38.5, BB/SN 40; allowed 30–42). */
  fteHoursPerWeek: number
  demand: DemandRule[]
  addOns: AddOn[]
  presence: PresenceRule[]
  /** Default counting share per qualification in percent (0–100). */
  staffShares: Record<Qualification, number>
  /** Qualifications that count as Fachkraft for presence and fachkraftFte; default ['fachkraft']. */
  fachkraftQualifications?: Qualification[]
  quotas: Quota[]
  /** Group types the state calculates with (BW, NI, SL, NW). */
  groupTypes?: { key: string; label: string }[]
}

// --- engine inputs and outputs ---

export interface DemandChild {
  ageBand: AgeBand
  weeklyHours: number
  /** Age in months on the reference day; needed only for rows with `ageMonths`. */
  ageMonths?: number
  /** Individual weight (e.g. integration); the higher of this and the row's weight counts. */
  weight?: number
}

export interface DemandInput {
  groupType: string | null
  /** Average daily opening of the group in minutes (group_fte scaling); null = not entered. */
  openingMinutesPerDay: Minutes | null
  children: DemandChild[]
}

export interface RequirementLine {
  key: string
  label: string
  fte: number
  /** Whether the line is part of the required FTE checked against the plan. */
  counts: boolean
}

export interface Requirement {
  /** Required FTE: sum of the counting lines. */
  fte: number
  /** Base demand without add-ons. */
  demandFte: number
  /** Fachkraft FTE demanded by the demand rows (NW); 0 if the state has no such rows. */
  fachkraftFte: number
  lines: RequirementLine[]
  /** Children no demand row matched (missing group type, hours outside every band …). */
  unmatchedChildren: number
  /** false = presence-only state: no Soll/Ist to show. */
  periodCheck: boolean
}

export interface PlannedStaff {
  qualification: Qualification | null
  /** Counting share in percent; null = the state's default for the qualification. */
  share: number | null
  /** Planned working hours in the period. */
  hours: number
}

export interface Planned {
  fte: number
  fachkraftFte: number
  byQualification: Record<Qualification, number>
  /** FTE of staff without a qualification. */
  unqualifiedFte: number
}

export interface QuotaLine {
  key: string
  label: string
  kind: Quota['kind']
  /** min_share / demand_minimum: the minimum; max_share: the maximum. */
  limit: number
  have: number
  ok: boolean
}

export type Phase = 'haupt' | 'rand' | 'always'

export interface PresenceSlot {
  /** Start of the 15-minute slot. */
  minute: Minutes
  children: { ageBand: AgeBand }[]
  staff: { qualification: Qualification | null; share?: number | null }[]
}

export interface Shortfall {
  from: Minutes
  to: Minutes
  have: number
  need: number
  /** true = too few Fachkräfte; false = too few staff in total. */
  fachkraft: boolean
}
