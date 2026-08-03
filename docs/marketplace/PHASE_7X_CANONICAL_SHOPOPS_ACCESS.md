# Phase 7X canonical ShopOps access

Status: implemented in source only on `marketplace/phase-7x-billing-production-readiness`.
No migration, repair, commit, push, merge, deployment, or live Shopify request was performed.

## Evidence correction

The original read-only audit conclusion that the demo shop had zero
`dashboard_memberships` was not valid. The live database metadata established:

- `shopops_auditor` has `row_security = on` and `rolbypassrls = false`.
- `dashboard_memberships` has RLS enabled and no policy visible to the auditor.
- The other three permission tables in scope do not have RLS enabled.
- `user_location_access.membership_id` has a validated foreign key to
  `dashboard_memberships(id)` with `ON DELETE CASCADE`.
- Both scoped location rows have a non-null membership reference.

The auditor therefore sees zero membership rows because RLS filters them, not
because the referenced rows are proven absent. It also reports a left join as
unmatched for the same reason. A normal application transaction could not leave
either reference globally absent while the validated foreign key remains in
force. No other tenant's membership row was read to bypass this boundary.

The strongest evidence-supported origin is:

1. The owner/admin `user_location_access` row was created on 2026-07-04, before
   the 2026-07-31 membership migration. That migration created memberships from
   legacy access rows and backfilled `membership_id` by person, normalized email,
   then hidden Shopify user identity. The browser never supplied that ID.
2. The Outlook/Laval row was created on 2026-08-02, after the membership
   migration. The then-current People action called
   `replace_dashboard_membership_access`, which resolved or created the
   membership server-side and inserted its location rows in the same PL/pgSQL
   function. The route did not accept a membership ID from form data.

The available read-only credential cannot establish whether either referenced
membership belongs to the target shop, because RLS hides the referenced row.
The pre-consolidation single-column foreign key allowed a same ID from another
shop, so same-shop ownership must be checked by a service-role audit before any
repair. The IDs are not proven deleted, globally unused, client-generated, or
partially committed. Claiming any of those origins would contradict the
available constraint and RLS evidence.

## Source of truth

Before Phase 7X, report authorization already treated `dashboard_memberships`
as authoritative, but several adjacent paths still treated
`user_location_access` as identity or lifecycle data. The result was an
incompletely consolidated model rather than proof of two missing membership
rows.

After Phase 7X:

- `staff_people` is the shop-scoped person and archive record.
- `dashboard_memberships` is the only source of ShopOps role, owner state,
  membership status, and login binding.
- `user_location_access` is accepted only after its membership is found in the
  same shop and its person/email identity agrees with that membership.
- `staff_identity_aliases` remains attribution/login identity metadata and never
  grants ShopOps access.

## Read/write inventory

| Path                          | Reads                                                                                         | Writes                                                                        | Canonical identifier                                           | Transaction                               | Membership/shop verification                                                                             | Partial/orphan or optimistic behavior                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| People loader                 | People, aliases, memberships, location access, reporting locations, POS metrics               | None                                                                          | Membership ID after shop/person resolution                     | Read-only                                 | Shared canonical resolver validates membership, shop, person, email, and hidden binding                  | Invalid rows become `Needs attention`; they never supply role or locations |
| Add person: Sales only        | People and email aliases                                                                      | Person/alias only                                                             | Person ID                                                      | Existing non-access flow                  | Shop-scoped person/email checks                                                                          | Does not grant ShopOps access                                              |
| POS identity synchronization  | Order-line identities, aliases and their joined people                                        | POS aliases only                                                              | Shop/type/value alias key                                      | Batched upsert                            | Shop-scoped alias key; composite alias→person FK hardens new mappings                                    | Cannot grant a membership or location scope                                |
| Identity-attention diagnostic | Verified session identity, people and aliases                                                 | A pending person/email/hidden alias when no membership can be safely resolved | Verified session identity to person ID                         | Best-effort diagnostic writes             | Shop-scoped; pending aliases are explicitly non-authoritative                                            | Individual diagnostic failures are tolerated; authorization still denies   |
| Add person: ShopOps           | Actor membership, people, aliases, memberships, reporting locations                           | Person, email alias, membership, location rows                                | Server-resolved person and membership IDs                      | `grant_or_update_shopops_access`          | Actor, person, email, role, shop, locations, uniqueness and capacity checked inside one lock/transaction | No person or location survives a failed membership operation               |
| Edit role/locations           | Same as grant                                                                                 | Person canonical email/name, membership role/status, replacement scope        | Existing shop/person membership                                | Same RPC                                  | Same-shop actor/person/membership and valid reporting locations                                          | Browser supplies person/email/role/locations, never membership ID          |
| Re-enable                     | Existing disabled membership and preserved location rows                                      | Same membership set active; submitted location scope replaces preserved scope | Existing membership ID                                         | Same RPC                                  | Unique shop/person lookup                                                                                | Reuses the membership; no duplicate seat                                   |
| Revoke                        | Actor and target membership                                                                   | Membership status only                                                        | Server-resolved target membership ID                           | `disable_dashboard_membership`            | Active owner/admin actor and same-shop target                                                            | Locations, aliases, attribution and history are preserved                  |
| Archive                       | Actor, person, membership, aliases                                                            | Membership disabled and person archived, or unused person deleted             | Shop/person membership                                         | `archive_staff_with_dashboard_protection` | Same-shop actor/person; owner and last-admin protected                                                   | Location configuration is preserved; active access cannot survive archive  |
| Restore person                | Shop/person                                                                                   | Person active flag                                                            | Person ID                                                      | `restore_archived_staff`                  | Shop-scoped person                                                                                       | Membership remains disabled until explicit re-enable                       |
| Edit person profile           | Actor, person and optional membership                                                         | Person plus denormalized membership/scope label                               | Shop/person membership                                         | `update_shopops_person_profile`           | Same-shop actor/person; membership login email must be edited through access                             | Former ignored follow-up write errors are removed                          |
| First verified sign-in        | Canonical membership/person plus verified Shopify session identity                            | Person email, aliases, hidden binding, denormalized location identity         | Membership/person selected from verified identity              | `bind_verified_shopops_identity`          | Same-shop membership/person plus uniqueness checks                                                       | All identity updates commit or roll back together                          |
| Duplicate access resolution   | Memberships, aliases, people and membership-linked scope                                      | Aliases/person/membership/scope consolidation                                 | Owner, revoked and waiting membership IDs selected server-side | `resolve_duplicate_shopops_access`        | RPC repeats owner, shop, identity and attribution checks                                                 | Former compensating multi-request writes were removed                      |
| Owner materialization         | Verified Shopify owner identity, memberships, people, aliases                                 | Person, aliases, owner membership, `*` scope                                  | Server-verified Shopify identity                               | `materialize_dashboard_owner`             | Shop lock, owner uniqueness and identity conflict checks                                                 | One canonical owner graph is created atomically                            |
| Dashboard open                | Verified Shopify session, canonical membership, billing, membership-linked scope, report data | First-sign-in/owner materialization only                                      | Verified user ID/email to membership ID                        | Identity RPCs before report reads         | Active membership required before billing and locations                                                  | Invalid location rows cannot authorize reports                             |
| Settings/entitlements         | Memberships and reporting locations                                                           | None in Plan loader                                                           | Shop-scoped membership IDs                                     | Read-only                                 | Uses canonical membership counts                                                                         | Billing stays shop/offline-context based; only Shopify owner can manage it |
| Reporting-location management | Active actor membership and locations                                                         | Reporting-enabled flags                                                       | Actor membership ID                                            | `select_reporting_locations`              | Active same-shop owner/admin                                                                             | Independent of per-member access grants                                    |
| Legacy permissions route      | None                                                                                          | None                                                                          | None                                                           | Redirect only                             | N/A                                                                                                      | Redirects to `/app/people?tab=access`                                      |
| Maintenance audit/repair      | People, memberships and location scope for one explicit shop                                  | None by default; owner/person/membership/scope only with both apply controls  | Shop and optional normalized email                             | One repair RPC transaction                | Service-role audit proves same-shop graph; RPC revalidates every invariant                               | Masked output; post-repair audit; any RPC invariant failure rolls back     |
| Shop initialization footprint | Counts people, aliases and location scope only to decide whether an initial rebuild is needed | No permission row                                                             | Shop domain                                                    | Read-only permission footprint            | Every count is shop-scoped                                                                               | Does not authorize access                                                  |
| Shop compliance redaction     | None from permission tables                                                                   | Deletes scope, memberships, aliases and people in dependency order            | Verified compliance-webhook shop domain                        | Idempotent shop-redaction workflow        | All deletes are shop-scoped                                                                              | Deliberate legal deletion, not a merchant permission lifecycle operation   |

Direct POS alias/person workflows remain independent of ShopOps authorization.
They may create or map a sales-attribution person, but their success copy states
that dashboard access was not changed.

## Conflicting behavior removed

- People formerly attached location rows to a profile when `person_id` matched,
  even if the row did not resolve through that person's canonical membership.
- Location labels could therefore display legacy scope beside a `Needs attention`
  state. They now use only validated membership-linked rows.
- Add person formerly committed `staff_people` (and sometimes restored it) before
  the membership RPC. A failed access grant could leave a partial person.
- Owner materialization formerly created only a membership. It now creates or
  reuses the person, maps hidden/email identities, and creates one `*` scope.
- Revoke and archive formerly deleted location rows. They now preserve scope for
  explicit re-enable and retain attribution/history.
- First-sign-in identity synchronization formerly used several best-effort
  writes and could return `bound_alias_sync_pending`. It now uses one RPC.
- Duplicate access formerly used compensating application writes. It now uses
  one revalidating transaction.
- Profile editing formerly returned success after suppressing membership or
  location-label update errors. The profile RPC now commits all related labels
  together and refuses login-email changes outside the access editor.
- Legacy SQL functions `replace_staff_dashboard_access`,
  `remove_staff_dashboard_access`, `remove_or_archive_staff`, and
  `replace_dashboard_membership_access` used location rows as access/lifecycle
  state. They remain historical migration artifacts only; merchant routes no
  longer call them. They should be revoked/dropped in the later contract
  migration after the new application is established.

## Call graphs

### Add a person with ShopOps access

`authenticate.admin` → `assertAdminAccess` → refresh shop-level plan limits →
validate browser email/role/location input →
`grant_or_update_shopops_access` → lock shop → verify actor → find/create or
explicitly restore person → find/create/re-enable one membership → replace
membership-linked locations → commit → success UI.

### Edit role or locations

`authenticate.admin` → `assertAdminAccess` → refresh plan limits → accept person,
email, role and locations (no membership ID) → `grant_or_update_shopops_access` →
resolve same shop/person membership → validate role/location/admin/capacity
invariants → update membership → replace its scope → commit.

### Revoke and re-enable

Revoke: authenticated admin → resolve target membership by shop/person →
`disable_dashboard_membership` → protect owner/last admin → set `disabled` →
preserve locations/person/aliases/history.

Re-enable: authenticated admin → edit preserved configuration →
`grant_or_update_shopops_access` → resolve the disabled membership → set `active`
on the same ID → replace scope atomically.

### Owner materialization

Verified Shopify session → `materializeVerifiedOwner` → resolve non-conflicting
verified identifiers → `materialize_dashboard_owner` → lock shop → reuse/create
person → map email and hidden identity → reuse/create one owner membership →
replace owner scope with `*` → commit → reload canonical permission context.

### Open `/app/db-dashboard`

`authenticate.admin` → initialize shop → resolve/materialize canonical identity →
require active membership → resolve shop billing through offline app context →
resolve plan entitlements → load same-shop canonical membership scope → filter
reporting locations → load report rows. Owners/admins see all enabled reporting
locations; managers/viewers see only validated membership-linked locations.

## Schema invariants and migration strategy

Migration `20260802120000_canonical_shopops_access.sql` is required. It adds:

- unique `(shop_domain, id)` keys for people and memberships;
- a new-write check requiring every membership to have a person;
- a new-write check requiring every location row to have a membership;
- composite same-shop foreign keys for membership→person,
  alias→person, location→person, and location→membership;
- transactional grant/update, owner, identity-binding, duplicate-resolution, and
  controlled-repair RPCs;
- revoke/archive definitions that preserve location configuration.

Existing unique shop/person, normalized email, hidden Shopify identity, and
single-owner indexes are retained and not weakened.

The new checks and composite foreign keys are `NOT VALID`: they reject bad new
writes immediately while allowing an expand deployment to precede controlled
legacy repair. No legacy row is silently deleted or rewritten by the migration.

### Preflight

Run the read-only maintenance audit for each shop. Confirm:

- each membership resolves to a person in the same shop;
- each location row resolves to a membership/person in the same shop;
- one active owner exists and has one `*` scope;
- no duplicate shop/person, email, or hidden identity memberships exist;
- the proposed repair preserves all POS aliases and only changes access tables.

### Safe deployment order

1. Deploy the expand migration.
2. Deploy the application using the canonical resolver/RPCs.
3. Run read-only audits.
4. Run repair dry-runs and approve each diff.
5. Apply repairs explicitly, one shop transaction at a time.
6. Re-run audits and application smoke tests.
7. Validate the four `NOT VALID` constraints.
8. In a later contract migration, make the two required columns `NOT NULL`,
   remove redundant single-column foreign keys, and revoke/drop unused legacy
   permission RPCs.

### Rollback

Before constraint validation, application rollback is straightforward: redeploy
the prior application, revoke the new and redefined RPCs from `service_role`, restore the
prior function definitions from the 2026-07-31 migration, drop the new `NOT
VALID` constraints, and drop the two extra composite unique indexes. Do not undo
an applied data repair blindly; restore a database snapshot or use the repair
audit's before-state under an approved incident plan.

## Maintenance commands

```text
npm run shopops:access-audit -- --shop <shop> [--email <email>]
npm run shopops:access-repair -- --shop <shop> [--email <email>]
```

Audit performs selects only. Repair is a dry-run unless `--apply` is present.
When the runtime is production, `--confirm-production` is also required. Output
contains masked email, booleans, roles, counts and merchant-facing location names;
it never prints raw Shopify identities, membership/person IDs, tokens, sessions,
or credentials. Apply calls one transactional RPC and re-audits invariants.

## Demo-shop dry-run

The limited auditor can safely establish this proposed target from visible
person/location metadata, but cannot compare it with RLS-hidden memberships:

- Owner: resolve the existing hidden owner identity server-side; reuse or create
  one owner person; reuse or create one active owner membership; create one
  All-reporting-locations row; reject ambiguous identities.
- Outlook user: reuse the one active person for the normalized email; reuse,
  create, or re-enable one Viewer membership; retain a hidden identity only if
  the canonical membership/alias proves it; otherwise leave it waiting for first
  verified sign-in; assign Laval Store only.
- Repoint visible location rows only after the same-shop memberships exist.
- Preserve POS/sales aliases, attribution, reporting history, orders, billing,
  sync data and financial configuration.

The repair RPC decides whether an existing membership can be reused; it does not
materialize a supposedly “globally unused orphan ID” based on the RLS-filtered
audit. No repair was applied.
