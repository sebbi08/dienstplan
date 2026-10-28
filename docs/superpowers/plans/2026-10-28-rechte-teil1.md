# Rechte und Rollen, Teil 1 (Umstellung ohne sichtbare Änderung) – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every authorization check asks "does this person have permission X (for this group)?" instead of checking the role, while every role and person keeps exactly today's rights.

**Architecture:** A permission catalog with role defaults and an `effectivePermissions` resolver in `shared/domain/permissions.ts`; the session user carries the resolved set (recomputed per request); route guards become `requirePermission(event, key)`; service and client role checks switch to the set. No storage for custom settings yet (Teil 2) — defaults plus today's per-person flags give the set.

**Tech Stack:** Nuxt 4, Nitro, drizzle-orm + better-sqlite3, Nuxt UI 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-27-rechte-und-rollen-design.md` (§2–§4). **Inventory (read it — routes, checks, proposed catalog, risks):** `docs/superpowers/plans/2026-10-28-rechte-teil1-inventar.md`.

## Global Constraints

- **Behaviour identical** after every task: no route, page, menu entry or data field changes for any role (Träger, Leitung, Mitarbeiter, Tablet incl. tablet unlocked by Leitung / Mitarbeiter / person without account). UI texts unchanged.
- No migration in Teil 1 (no new table/column). Today's per-person grants stay where they are and are folded in by the resolver: `users.can_edit_children` → `children.edit`; `leave_planners` → `leave.plan` (admin only in its own facility, as `isPlanner` does); global setting `contract_visible_to_admins` → `employees.contractView` for admin. `form_editors`, key educator, tablet visibility switches, `retention_settings.employee_delete`, "never your own" rules and `stamp_via` stay business rules next to the catalog (inventory §6 "Not expressible").
- Catalog = inventory §6 (56 keys, labels German), with these controller rulings: keys marked **P-fix** or "P-fix recommended" are provider-only (`providerOnly: true`); `children.ownAccount` models the tablet-only rule; group scope: "own group" = today's `groupRight` semantics, and a person **without home group acts in all groups** (today's behaviour; spec §3 updated accordingly).
- Provider: all permissions. Terminal role: not in the catalog, its guards (`requireTerminal`, tablet branches) stay.
- Permissions recomputed on every request where the session user is resolved (`getActiveUser`), so a role/flag change applies immediately.
- No new npm dependencies; never `npm install`/`npm ci`/npx downloads; never kill processes by image name; port 3000 / `.data/app.db` untouched; never read outside `C:\Users\schad\Code`.
- Tests: `npx vitest run <file>`; all `npm test`; `npm run typecheck`; `npm run build`.

## Review Focus

1. Route matrix: for every file under `server/api`, the roles allowed before (today's guard, frozen in Task 1) equal the roles allowed by its permission under the defaults (Task 1 fixture, Task 2/3 test).
2. Tablet unlocked by a Mitarbeiter with home group vs. a Springer without group vs. a person without account: child read/write per group exactly as today (Task 3 tests).
3. A Mitarbeiter with `can_edit_children` edits children at the tablet but not with the own account; a Leitung with `leave_planners` plans leave only in its facility; Leitung sees contract fields only while `contract_visible_to_admins` is on (Task 1 resolver tests + existing service tests).
4. Data-dependent answers (inventory risk 4: plan draft vs released, contract fields, groups capacity, children archived/purgeOn/canEdit, reminders, setup checklist, leave-settings, staffing-settings canEdit) unchanged — existing service tests stay green without edits to their expectations.
5. Client: menu entries, middleware redirects and buttons per role unchanged (Task 4 tests for navMenu + middleware; controller browser check).

---

### Task 1: Catalog, resolver, frozen route matrix

**Files:** Create `shared/domain/permissions.ts`, `tests/domain/permissions.test.ts`, `tests/fixtures/route-access-before.json` (+ a small script under `scripts/` or a test helper that produced it from today's guards — commit both).

**Interfaces (produced):**
- `type PermissionKey` (union of the 56 keys), `interface PermissionDef { key; label: string; area: PermissionArea; requires: PermissionKey[]; implies: PermissionKey[]; scoped: boolean; providerOnly: boolean }`, `PERMISSIONS: readonly PermissionDef[]`.
- `ROLE_DEFAULTS: Record<'admin' | 'observer', PermissionKey[]>` (inventory §6 "Defaults").
- `interface PermissionInput { role: Role; canEditChildren: boolean; isLeavePlanner: boolean; contractVisibleToAdmins: boolean }` and `effectivePermissions(input): ReadonlySet<PermissionKey>` — provider → all; terminal → empty; else defaults + legacy flags, then `implies` added and keys with missing `requires` dropped.
- `can(set, key): boolean`.
- Fixture `route-access-before.json`: `{ "<route file relative to server/api>": ["provider","admin",...] }` for all 292 files, derived from today's guards (provider/admin/observer/terminal; child routes: who passes the guard with the own account and who at the tablet — record tablet access as `"tablet"`).

- [ ] Failing tests: resolver for each role, legacy flags (RF3), implies/requires, providerOnly keys never in admin/observer defaults, catalog consistency (no unknown keys in requires/implies, no cycles) → implement → fixture generated and committed → commit `feat: permission catalog and resolver`.

### Task 2: Session permissions and route guards (non-child routes)

**Files:** `server/utils/auth.ts` (`SessionUser.permissions` computed in `getActiveUser`; `requirePermission(event, key, options?)` keeping the facility semantics of the guard it replaces — settings-facility override, `requireFacility` where the old route had it; `requireProvider` stays for providerOnly keys or becomes `requirePermission` of a providerOnly key), all non-child routes per inventory §2.1–2.4, 2.7–2.13, the redundant service checks of inventory risk 5 (they must ask the permission set, not the role), `tests/api/permissions.test.ts` rewritten: every route either declares exactly one permission (grep `requirePermission(event, '<key>'`) or keeps an allowed fixed guard (terminal, user/own-data, public), and the roles allowed by that permission under the defaults equal `route-access-before.json` (RF1).

- [ ] Failing test: new permissions test against the fixture → convert routes area by area (run the area's service tests after each area) → `npm test`, typecheck → commit `refactor: routes check permissions instead of roles`.

### Task 3: Children and tablet

**Files:** `server/utils/auth.ts` (`requireChildReader/Editor/Manager` → permission based), `server/services/tabletUnlock.ts` (`ChildViewer` gets `permissions` of the unlocking person; person without account = observer defaults), child services and `shared/domain/childForms.ts`/`roles.ts` checks listed in inventory §3 (`isManager(viewer.role)`, `mayEditChildren`) → `can(viewer.permissions, …)`; `groupRight` semantics unchanged; child routes (inventory §2.5–2.6) in the permissions test.

- [ ] Failing tests: RF2 (three tablet cases), RF3 child part → convert → all child/tablet service tests green without changed expectations → `npm test`, typecheck → commit `refactor: child records and tablet check permissions`.

### Task 4: Client

**Files:** session/user payload exposes `permissions: PermissionKey[]` (where the client reads the user today), composable `app/composables/useCan.ts` (`can(key)`), `app/utils/navMenu.ts`, route middleware, `useChildRights.ts`, pages/components from inventory §4 → permission based; tests for navMenu and middleware per role equal today's.

- [ ] Failing tests: RF5 → convert → `npm test`, typecheck, build → commit `refactor: client shows by permission`.

### Task 5: Controller check (no implementer)

- [ ] Scratch copy, as Träger, Leitung and Mitarbeiter (and tablet unlocked): menus, main pages, a few writes per area — identical to production behaviour.
