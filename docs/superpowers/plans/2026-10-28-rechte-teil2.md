# Rechte und Rollen, Teil 2 (Seite „Rechte und Rollen“) – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Träger sets the rights of Leitung and Mitarbeiter per role and as exceptions per person, via bundled switches; today's per-person grants become exceptions; the open points of Teil 1 are closed.

**Architecture:** Bundles in `shared/domain/permissionBundles.ts` map to catalog keys; role settings and person exceptions stored in two tables; `effectivePermissions` reads them; provider-only API for role settings and exceptions (Leitung only for the children-edit exception); a rights page plus an exceptions block on the person's Zugang tab.

**Tech Stack:** Nuxt 4, Nitro, drizzle-orm + better-sqlite3, Nuxt UI 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-28-rechte-teil2-design.md` (on `2026-10-27-rechte-und-rollen-design.md`). Open points: `docs/superpowers/plans/2026-10-28-rechte-teil2-notizen.md`.

## Global Constraints

- Bundles exactly as the spec table §2 (keys per bundle verbatim); `settings.staffing` and `children.schoolSettings` become `providerOnly` (no behaviour change: Leitung never had them).
- Defaults expressed as bundles reproduce today's ROLE_DEFAULTS for admin and observer exactly, **except** the one approved change: Leitung gets `cash.reopen` (bundle „Monate abschließen und wieder öffnen“). The route fixture is regenerated once for that change; its diff may only add "admin" to the cash reopen route(s).
- One migration `rights`: `role_bundles` (role 'admin' | 'observer' [| 'group_lead' in Teil 3 — keep the column text], bundle text, enabled bool, scope 'group' | 'facility' null) and `user_bundle_overrides` (user_id FK cascade, bundle, effect 'grant' | 'revoke', scope null). No rows = defaults. Data migration: `users.can_edit_children = 1` (observer) → override grant `children.edit` scope 'group'; admin accounts in `leave_planners` → override grant `leave.plan`; app setting `contract_visible_to_admins` on → role row admin `employees.contractView` enabled (off → disabled row). Old columns/settings stay in the DB but are no longer read for rights; `leave_planners` stays only as notification recipients of Träger accounts.
- Resolution: role rows (else defaults) → overrides (grant adds, revoke removes) → expand bundles to keys → `resolvePermissions` (implies/requires) → providerOnly keys never granted to non-providers; unknown bundle names ignored.
- Who changes what: role settings and all exceptions only the Träger (`rights.manage`); the Leitung may grant/revoke only the `children.edit` bundle exception for observer accounts of its facility (today's „darf Kinderakten pflegen“). Server enforces.
- Scope: bundles with group scope (children view/attendance/edit) store 'group' | 'facility'; 'group' = today's groupRight semantics, no home group = all groups.
- Close all items of the Teil-2 notes file that concern rights (person sets instead of `rolePermissions(db, role)`, employees list role, getLeaveSettings single source, facilities.get key, client key fixes, unified tablet model, tests listed there).
- UI German, informal „du“; no new npm dependencies; never npm install/npx downloads; never read outside `C:\Users\schad\Code`.
- Tests: `npx vitest run <file>`; all `npm test`; `npm run typecheck`; `npm run build`; `node scripts/route-access-snapshot.mjs --check`.

## Review Focus

1. With an empty settings DB, every role's effective permissions equal Teil 1 (+ cash.reopen for Leitung); after the data migration of a DB with can_edit_children / leave_planners / contract switch set, every account's effective permissions equal those before the migration (Task 1 tests).
2. A role change affects all accounts of the role on their next request; a person exception overrides the role both ways; scope respected (Task 1 + Task 2 tests).
3. Dependencies: granting a bundle pulls its required bundles; revoking removes dependents; the server never stores a providerOnly or unknown bundle (Task 2 tests).
4. Leitung: may toggle only the children-edit exception for Mitarbeiter of its facility — anything else 403 (Task 2 tests).
5. Menus/pages follow the new rights (a Mitarbeiter granted „Vorlagen bearbeiten“ sees the edit buttons; a Leitung with „Kasse ansehen“ revoked loses the cash menu) (Task 3 + controller check).

---

### Task 1: Bundles, storage, migration, resolver

**Files:** Create `shared/domain/permissionBundles.ts` + tests; `shared/domain/permissions.ts` (providerOnly flags); schema + migration `rights` (+ data migration) + db test; `server/services/permissions.ts` (`accountPermissions` reads role rows + overrides); route fixture regeneration (cash reopen only); tests for RF1, RF2.

- [ ] Failing tests → implement → commit `feat: rights bundles, role settings and person exceptions in the database`.

### Task 2: Rights API and Teil-1 leftovers

**Files:** Create `server/services/rights.ts`; routes `GET/PUT /api/rights/roles`, `POST /api/rights/roles/[role]/reset`, `GET/PUT /api/users/[id]/rights`; permission test/fixture for new routes; remove the old setters (users PUT `canEditChildren`, contract-visibility PUT, planner part of leave-settings/module PUT → keep Träger notification list) or redirect them to the new storage; all rights items from the Teil-2 notes file; tests RF2–RF4.

- [ ] Failing tests → implement → commit `feat: rights API, old per-person switches moved into rights`.

### Task 3: Pages

**Files:** rights page (e.g. `app/pages/admin/rights.vue`, linked from Mehr → Benutzer and the Benutzer page), bundle table per role with scope, dependency hints/confirmations, reset; exceptions block on the person's Zugang tab (Träger: all bundles; Leitung: only „eintragen und Akten ändern“ for Mitarbeiter); remove/redirect old UI switches (AccessSection „darf Kinderakten pflegen“ becomes the exception toggle for the Leitung; contract-visibility switch; planner selection hint); `RightsTable.vue` shows the actual settings (or is replaced by the rights page read-only for non-providers if it is shown to them); de.ts; BETRIEB.md.

- [ ] `npm test`, typecheck, build → commit `feat: rights page and person exceptions`.

### Task 4: Controller check (no implementer)

- [ ] Scratch copy: change a role setting and an exception, see menus/pages change for the affected account; Leitung exception toggle; migration of old flags; phone width.
