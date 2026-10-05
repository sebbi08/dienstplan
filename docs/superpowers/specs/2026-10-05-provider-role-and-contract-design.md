# Träger role and contract data — design

Approved in chat on 2026-10-05.

## Roles

| Key (code) | UI label | Rights |
|---|---|---|
| `provider` (new) | Träger | Everything the Leitung may do. Also edits contract data, decides whether the Leitung sees it, and manages Träger accounts. |
| `admin` | Leitung (was "Administrator") | As before, but cannot edit contract data or manage Träger accounts. |
| `observer` | Mitarbeiter (was "Beobachter") | As before. |
| `terminal` | Stempel-Tablet | As before (a device, not a person). |

- `requireAdmin` accepts `provider` and `admin`. The new `requireProvider` accepts only `provider`. The UI uses one helper, `isManager(role)`.
- Only a Träger may:
  - create a user with the role `provider`;
  - give a user the role `provider`, or take it away;
  - change or deactivate a Träger account, or reset its password.
- At least one active Träger must remain.
- The old "at least one active admin" rule becomes "at least one active manager" (Träger or Leitung). With a Träger always present, this always holds.
- Migration: the first existing `admin` account (lowest id) becomes `provider`. On a fresh install, the initial user from the environment is created as `provider`. Emergency reset from the environment makes the user an active `provider`.
- The joiner rule "no negative leave in the joining year" is unchanged. It does not use the new data.

## Contract data per employee

- **employed_since:** date. The UI also shows how long that is.
- **job_key:** one of the TVöD SuE job titles below, or `other`.
- **job_other:** free text, only used with `other`.
- **pay_group:** `S 2` … `S 18`. A group is suggested when a job is chosen, and can be changed.
- **pay_level:** 1–6. A level is suggested from employed_since (level 2 after 1 year, 3 after 4, 4 after 8, 5 after 12, 6 after 17 years), together with the date the next level is due. It can be changed.

Job titles and their suggested groups:

| Job title | Suggested group |
|---|---|
| Kinderpfleger/in | S 3 |
| Sozialassistent/in | S 3 |
| Erzieher/in | S 8a |
| Erzieher/in mit besonders schwierigen fachlichen Tätigkeiten | S 8b |
| Heilerziehungspfleger/in | S 8a |
| Sozialpädagoge/-pädagogin bzw. Kindheitspädagoge/-pädagogin | S 11b |
| Ständige Vertretung der Leitung | none |
| Leitung | none |
| Sonstige (free text) | none |

The suggested groups are a summary for convenience, not legal advice. The UI says they must be checked.

## Visibility

- App setting `contract_visible_to_admins`, default off. Only a Träger can change it.
- The server sends contract data only to a Träger, or to the Leitung when the setting is on. Observers, employees and the tablet never receive it.
- Only a Träger can edit the data: `PUT /api/employees/:id/contract`.
