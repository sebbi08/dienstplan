# Personalschlüssel – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staffing requirement („Personalschlüssel“) per group and facility after the facility's federal state, compared with the planned staff, shown monthly in a new tab and as time-of-day warnings in the duty plan; all state values preset, editable by the Träger.

**Architecture:** Versioned state presets as data in `shared/domain/staffing/`, a pure calculation engine per method (child FTE ratio, weighted child hours, FTE per group, hours per group form) plus a presence check per 15-minute slot. The server combines presets with the Träger's per-facility overrides, children by contract (age, care type hours) and planned staff hours (weighted by qualification share) into a monthly report and day warnings. UI: tab, settings, employee/group/care-type fields.

**Tech Stack:** Nuxt 4, Nitro, drizzle-orm + better-sqlite3, Nuxt UI 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-21-personalschluessel-design.md` · **Research (numbers, sources, confidence):** `.superpowers/sdd/personalschluessel-research.md` (git-ignored; the controller copies the needed numbers into the task briefs)

## Global Constraints

- UI German, informal "du"; code, identifiers, comments, commits English. No Docker/CI changes.
- Never run `npm install`/`npm ci` or npx downloads. Never kill processes by image name; stop only processes you started (by PID). Port 3000 is the controller's dev server — own checks on 127.0.0.1:3100 with `DATABASE_PATH` on a scratch DB copy.
- Branch `claude/staffing`, started from `claude/templates` (newest migration `0049_print_templates`); one migration `0050_staffing` (`npx drizzle-kit generate --name staffing`).
- Qualifications: `fachkraft` „Fachkraft“, `ergaenzung` „Ergänzungs-/Zusatzkraft“, `azubi_1`/`azubi_2`/`azubi_3` „Auszubildende/r (1./2./3. Jahr)“, `praktikant` „Praktikant/in“, `none` „keine pädagogische Kraft“; null = not entered. Share 0–100 % (integer), null = the state's default for the qualification.
- Methods: `fte_per_child`, `child_hours`, `group_fte`, `group_pauschale`; presence rules optional per state. FTE hours per week default 39 (state value, overridable 30–42).
- Child weekly hours = care type (end − start) × days per week (new field, default 5, 1–7). Age band on the first day of the month (monthly) / on the day (presence): `u3` (< 3 years), `ue3` (3 to school start — `effectiveSchoolStart`), `school`.
- Children counted: contract children of the group in the month (same rules as the Belegung/occupancy); presence check: children whose care type covers the slot on a care day.
- Planned staff („Ist“): work entries of the month (reuse `isWorkEntry`), effective group = entry group else the employee's home group, helpers count where they work; absences and codes crediting the daily target do not count; hours × share ÷ (FTE hours per week × weeks of the month) → FTE.
- Presets carry `validFrom`, `source` (law + paragraph), `confidence` ('high' | 'medium' | 'low'); 'low'/'medium' show „bitte prüfen“. The version valid on the month's first day applies.
- Träger overrides per facility (any numeric value of the preset), „Auf Vorgabe zurücksetzen“ deletes them; Leitung read-only. Routes `requireProvider(` for overrides, `requireAdmin(` for reading/report, employees/groups/care types like their existing routes.
- Warning type `staffing` in the plan: „‹Gruppe› ‹hh:mm›–‹hh:mm›: ‹n› ‹Kraft/Fachkraft/Kräfte/Fachkräfte›, nötig ‹m›“, consecutive slots merged; only care days with entered opening hours.
- The disclaimer text „Planungshilfe – keine rechtliche Prüfung. Bitte die Vorgaben mit der Heimaufsicht/dem Landesjugendamt abgleichen.“ shows in the tab and the settings.
- Tests: `npx vitest run <file>`; all: `npm test`; types: `npm run typecheck`; build: `npm run build`.

## Review Focus

1. BW Regelgruppe (1,8 FTE) with 25 children, two full-time Fachkräfte and one Azubi at 0 % → Ist 2,0, no red; with one Fachkraft absent all month → red. → Task 1/4 tests.
2. BY: 20 Ü3 children at 35 h and 5 U3 at 35 h (weight 2.0) → Soll = (20×35 + 5×35×2) ÷ 11 h/week; Fachkraftquote ≥ 50 %. → Task 1 test.
3. A preset version valid from 01.08.2026: July uses the old values, August the new. → Task 2 test.
4. A Leitung tries to change an override → 403; reset restores the preset. → Task 3 test.
5. Presence check BW: Hauptbetreuungszeit with 1 Fachkraft → one merged warning „Bären 7:00–8:00: 1 Fachkraft, nötig 2“; a Zusatzkraft does not count as Fachkraft. → Task 4 test.

---

### Task 1: Engine (domain)

**Files:** Create `shared/domain/staffing/types.ts`, `shared/domain/staffing/calc.ts`, `shared/domain/staffing/presence.ts`; Test `tests/domain/staffingCalc.test.ts`, `tests/domain/staffingPresence.test.ts`

**Interfaces (produces):**
- `type Qualification`, `type AgeBand = 'u3' | 'ue3' | 'school'`, `StaffingRuleSet { land; validFrom; source; confidence; method; fteHoursPerWeek; demand: DemandRule[]; addOns: AddOn[]; presence: PresenceRule[]; staffShares: Record<Qualification, number>; quotas: Quota[]; groupTypes?: { key; label }[] }` with `DemandRule`/`AddOn`/`PresenceRule`/`Quota` as in the research's „Minimal data model“ (trimmed to the four methods).
- `requiredFte(rules, input: { groupType: string | null; openingMinutesPerDay: number | null; children: { ageBand; weeklyHours; weight?: number }[] }): { fte: number; lines: { label; fte }[] }`
- `plannedFte(rules, staff: { qualification; share: number | null; hours: number }[], weeks: number): { fte: number; fachkraftFte: number }`
- `quotaLines(rules, required, planned)`
- `presenceShortfalls(rules, slots: { minute; children: { ageBand }[]; staff: { qualification }[] }[], phase: (minute) => 'haupt' | 'rand' | 'always'): { from; to; have; need; fachkraft: boolean }[]` (merged).
- [ ] Failing tests (Review Focus 1, 2, 5 + one per method) → implement → pass → commit `feat: staffing calculation engine (domain)`.

### Task 2: State presets

**Files:** Create `shared/domain/staffing/presets/<land>.ts` for all 16 states + `index.ts` (`presetFor(land, date): StaffingRuleSet`); Test `tests/domain/staffingPresets.test.ts`

- Numbers, sources and confidence from the research report (the brief carries them). States with only partial data still get a valid rule set with `confidence: 'low'` and a note.
- [ ] Failing tests: every state returns a valid set for 2026-10-01; versions switch on their dates (Review Focus 3 with BE/SN 01.08.2026); sample calculations BW, BY, BE, NW → implement → pass → commit `feat: staffing presets for all federal states`.

### Task 3: Data, settings, overrides

**Files:** schema + migration 0050; services `server/services/staffing.ts` (overrides, effective rules), routes `GET/PUT /api/staffing-settings` (+ reset), employee update (`qualification`, `staffingShare`), group update (`groupType`), care type (`daysPerWeek`); permissions; tests.

- [ ] Failing tests: Review Focus 4; validation; effective rules = preset ⊕ overrides; employee/group/care-type fields → implement → pass → commit `feat: staffing settings, qualifications and overrides`.

### Task 4: Monthly report and plan warnings

**Files:** `server/services/staffingReport.ts` (`staffingMonth(db, facilityId, year, month)`), route `GET /api/staffing/[year]/[month]` (`requireAdmin(`), `server/services/plan.ts` (warning type `staffing` into the day warnings), `shared/domain/warnings.ts` if needed; tests.

- [ ] Failing tests: Review Focus 1, 5 end to end; children without care type and staff without qualification listed; facility total; group of the day; helpers → implement → pass → commit `feat: staffing report and plan warnings`.

### Task 5: UI, print, docs

**Files:** tab „Personalschlüssel“ under Kinder (Leitung/Träger), print page, settings section (Träger edits, Leitung reads), employee form fields, group type select, care type days, warning text, `docs/BETRIEB.md`.

- [ ] Implement → `npm test`, typecheck, build, headless check → commit `feat: staffing tab, settings and warnings in the UI`.

### Task 6: Controller check (no implementer)

- [ ] BW facility on a scratch copy: group types, qualifications, a month with enough and one with too little staff; a day with a presence gap; a BY facility with weights.
