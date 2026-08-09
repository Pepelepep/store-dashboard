# ShopOps Marketplace final review status

Last verified: 2026-08-08

## Product promise to demonstrate

ShopOps lets a merchant configure staff access and analyze staff performance by
Shopify location. The Marketplace evidence must follow this story:

1. select a reporting location;
2. see that location's sales and staff performance;
3. compare locations when the signed-in role permits it;
4. configure reporting locations and staff access as an administrator.

No screenshot or screencast may expose real names, email addresses, order IDs,
or other personal data. Marketplace media must use the synthetic demo staff.

## REVIEW BLOCKERS

| Item | Status | Proof required before submission |
| --- | --- | --- |
| Live Owner/Admin/Manager/Viewer role QA | PASSED 2026-08-08 | The same authenticated non-owner Shopify account was exercised as Manager, Admin, and Viewer. Manager saw only Laval + Montreal and could compare them; Admin saw all three locations and administration; Viewer saw only Laval with no global selector, comparison, People, Costs, or Settings. Direct ShopOps Billing URLs were denied to Manager/Viewer and read-only for Admin. The account was restored to active Viewer · Laval only and the canonical DB graph was verified. |
| Chrome Incognito authentication and Viewer smoke | PASSED 2026-08-08 | A new private Chrome session authenticated as the non-owner test account with no normal-profile state. After a clean reload, direct Settings, People, Costs, and Compare Locations URLs were denied. Overview rendered only Laval, with no Montreal, third location, all-locations selector, Compare, Costs, People, or Settings navigation. |
| Reporting-location lifecycle | PASSED 2026-08-08 | Laval was disabled: reporting changed from three locations/118 orders/18,027.93 CAD to two locations/85 orders/13,500.87 CAD. Re-enabling restored the exact original totals. All 225 synthetic lines remained stored and all three Shopify locations remained active. |
| Billing lifecycle | LIVE PASS WITH PLATFORM BOUNDARY 2026-08-08 | Two clean stores selected and approved the hosted Growth trial at $0 in development. Uninstall changed the subscription to canceling and the app rendered that state correctly after reinstall. The secondary account that reached Shopify's hosted pricing had the high-trust Shopify `Store administrator` system role; it was not a low-privilege Shopify user. Those elevated roles were removed, leaving the custom `App users` role with ShopOps Studio access and neither `Approve app charges` nor app-management permission. Shopify still exposes $0 test approvals on this development store, so production paid-charge denial must be evaluated from Shopify's documented `Approve app charges` permission rather than inferred from dev-store test pricing. ShopOps plan controls and callback confirmation remain owner-only. |
| Fresh install/reinstall | PASSED 2026-08-08 | Two clean development stores completed install, managed OAuth, hosted pricing, first sync, reload, and uninstall. Lifecycle A also completed immediate reinstall, automatic expiring offline-token acquisition, successful post-reinstall sync, idempotent retained data, and a second uninstall. |
| Marketplace screencast | MISSING | Reviewer video shows install/onboarding, location setup, staff mapping, role behavior, reports, and billing. |
| Final listing screenshots | REPLACE | Capture dashboard-only frames after role QA, using synthetic staff and no PII. Do not expose the current Staff filter because it also lists identities from real synchronized data. |
| Automatic maintenance scheduler | PASSED 2026-08-08 | Render service `shopops-maintenance-tick` is active and completed successful maintenance runs while the two lifecycle stores synchronized. Keep it active through review. |
| Live compliance webhooks | IN PROGRESS | `app/uninstalled` was missing from the deployed Shopify configuration and was fixed in app version `shopops-studio-15`. Live retest proved both online and offline sessions drop to zero within seconds. Lifecycle B remains uninstalled from 2026-08-09 01:50 UTC for the real Shopify `shop/redact` delivery after 48 hours; an automated verification is scheduled for 2026-08-11 02:05 UTC. |
| Embedded-admin performance | TRACE PENDING AFTER RESTART | Shopify reports seven-day LCP p75 3,552 ms; Aug 9 is 3,556 ms across 28 loads. INP is good at 34 ms and CLS is 0.0. Render Starter is not saturated (roughly 20-30% memory, normally under 5% CPU with brief ~20% peaks); Supabase Micro is also not saturated (8% CPU, 42% memory, 1% disk I/O). Business queries are generally below 7 ms, with observed maxima below 20 ms. The strongest infrastructure risk is geographic: Render runs in Oregon while Supabase runs in `us-east-1`, so every database round trip crosses the continent. Render cannot move an existing service in place; quantify the loader/network share before cloning the service in Virginia. The Chrome DevTools trace server is configured in Codex but requires an app restart before its tools are available. |

## MUST FIX / COMPLETE

| Item | Status | Next action |
| --- | --- | --- |
| Demo staff attribution | FIXED 2026-08-08 | 225/225 synthetic lines map to six synthetic sellers across three locations. Preserve via `001_staging_demo_data.sql`. |
| Viewer experience | LIVE PASS 2026-08-08 | Viewer was locked to Laval, with no global selector, comparison, access management, Costs, Settings, or direct ShopOps Billing access. Live result: 33 orders and 4,527.06 CAD net for the selected period. |
| Manager experience | LIVE PASS AFTER FIX 2026-08-08 | Manager saw Overview and compared exactly the two assigned locations: Laval + Montreal, 85 orders and 12,499.86 CAD. A forbidden `Review product costs` CTA was discovered in Compare Locations, capability-gated, deployed, and live-retested absent together with `Add expenses` and the Costs navigation item. |
| Admin experience | LIVE PASS 2026-08-08 | Admin saw all three locations, 118 orders and 18,027.93 CAD, plus the administrative areas. ShopOps Plan & billing was read-only with no Manage plan action. |
| Owner-sensitive actions | LIVE PASS WITH DOCUMENTED SHOPIFY BOUNDARY | Owner restored QA Pilot after the controlled Solo test. ShopOps only exposes and confirms plan changes for Owner. Direct Shopify-hosted billing remains governed by Shopify staff permissions and cannot be represented as a ShopOps role guarantee. |
| Plan capacity enforcement | LIVE SOLO PASS; DEPLOYED GUARDS VERIFIED | Solo was activated temporarily with 3 reporting locations and 2 ShopOps users. ShopOps showed `3 of 1` and `2 of 1` over-capacity states, blocked Viewer reports, rejected a third ShopOps user without leaving any person/membership/grant row, and rejected saving all three locations without changing the current selection. QA Pilot was restored active with 3 locations and 2 users within capacity. The deployed database functions enforce serialized user/location limits and are executable only by `service_role`. Growth remains 5 locations/5 users; Multi-location remains 10 locations/unlimited users; QA Pilot is private and unmetered. |
| Shopify compliance webhooks | LIVE HANDLER PASS; REAL 48-HOUR DELIVERY PENDING | Shopify CLI delivered valid-HMAC samples for all three mandatory topics to production. `customers/data_request` was recorded as `received`; `customers/redact` completed with zero matching dummy orders; `shop/redact` completed with zero dummy rows and session deletion confirmed. Audit records retain no raw contact values. Lifecycle B remains the real automatic 48-hour `shop/redact` delivery proof. |
| API/scopes/privacy declarations | MANUAL CONFIRMATION NEEDED | Partner Dashboard declarations must exactly match deployed scopes and Protected Customer Data/read_all_orders approvals. |
| Listing validation | INCOMPLETE | Resolve feature media, final screenshots, active pricing plans, and screencast URL. |
| Shopify extension validation | CANDIDATE PASS 2026-08-08 | POS extension API `2026-01` was paired with stale `@shopify/ui-extensions` 2025.10 types, which blocked Shopify CLI validation. The dependency is now aligned to 2026.1.5; `shopify app build` passes and the extension bundle is ~9.1 KB compressed. Shopify accepted the complete non-live candidate version `shopops-studio-16-candidate`; release remains pending until the final smoke gate. |
| Privileged Supabase RPC grants | FIXED 2026-08-08 | Five SECURITY DEFINER functions were executable by anon/authenticated in the remote DB. Grants are now service-role-only and the security advisor has no remaining WARN findings. |
| Historical inventory identity | FIXED 2026-08-08 | Repaired 19 inventory-level rows with legacy `-` variant IDs through their canonical inventory-item relationship; the critical data-quality count is now zero. |
| People access semantics | FIXED IN BRANCH | Sales-only staff without dashboard membership now show “No access” instead of false “Needs attention” alerts. Successful access saves close the modal; revoked users no longer display stale assigned locations. Deployment verification remains. |
| Estimated-cost diagnostic copy | FIXED IN BRANCH | Removed the obsolete hard-coded “50% fallback” wording; the diagnostic now refers to the store-configured estimate. Deployment verification remains. |
| Uninstall session cleanup | FIXED AND LIVE-PASSED 2026-08-08 | Added the missing `app/uninstalled` subscription, released Shopify app version `shopops-studio-15`, and proved Lifecycle A and B each reach zero stored sessions after uninstall while historical merchant data is retained for the 48-hour compliance window. |
| Reinstall offline authentication | FIXED AND LIVE-PASSED 2026-08-08 | A reinstall initially exposed a 503 because only the online user session was present. ShopOps now exchanges the already-verified Shopify session token for an expiring offline token with refresh credentials. Render commit `ad6de8e` is live; Lifecycle A loaded, billed, and synchronized successfully. |

## SHOULD FIX IF LOW RISK

- Rename the generic demo location “Shop location” to a polished fictional store
  name before final media, if this does not affect existing Shopify IDs.
- Keep screenshot dates fixed to 2026-07-07 through 2026-08-07 and ensure every
  headline and chart uses the same applied range.
- Show filters only when they clarify the active location/date scope; crop the
  Shopify admin shell and avoid empty surrounding UI.
- Use six obviously fictional names in screenshots. Blur is a final safety net,
  not the primary privacy strategy.
- Supabase reports four unindexed access-graph foreign keys and seven duplicate
  indexes. These do not explain the current LCP, but should be cleaned through
  a reviewed migration after checking query plans; do not resize compute as a
  substitute.

## ACCEPTABLE FOR V1

- A viewer having exactly one assigned location and landing directly in their
  scoped reporting experience.
- Staff attribution based on POS session identity, with honest Unmapped and
  Unassigned states when production data cannot be resolved.
- Location comparison limited to Manager, Admin, and Owner according to their
  canonical scope.

## Live role matrix

| Capability | Owner | Admin | Manager | Viewer |
| --- | --- | --- | --- | --- |
| Global Overview | Yes | Yes | Assigned scope | No global overview |
| Compare locations | All | All | Assigned only | No |
| View location/staff reports | All | All | Assigned only | Assigned only |
| Configure reporting locations | Yes | Yes | No | No |
| Configure people/access | Yes | Yes | No | No |
| ShopOps Plan actions | Yes | Read-only | No access | No access |
| Direct Shopify-hosted paid app charges | Shopify decides | Requires Shopify billing/app authority | Requires Shopify billing/app authority | Requires Shopify billing/app authority |
| See Access Location management UX | Yes | Yes | No | No |

## Exact live QA sequence

1. Sign in as Owner and record the initial three reporting locations.
2. Disable one location in ShopOps reporting settings (not in Shopify itself).
3. Confirm Dashboard totals, comparison choices, and staff tables exclude it.
4. Confirm its historical rows remain stored and no Shopify source data changed.
5. **Passed:** Viewer reached only Laval through UI and server-enforced scope;
   there was no access-management or comparison UI and direct ShopOps Billing
   was rejected.
6. **Passed:** Manager compared Laval and Montreal only; the third location was
   absent from the UI and server scope.
7. **Passed:** Admin reached all locations and People/Location setup. ShopOps
   Billing was read-only. Shopify's direct hosted pricing page remained subject
   to the Shopify staff account's own billing/app permissions.
8. Re-enable the location as Owner/Admin and confirm reports and role scopes
   recover without a resync-related duplication.
9. Run Owner-only billing lifecycle, then uninstall/reinstall on a clean store.
10. Record the reviewer screencast and capture final listing images only after
    every preceding proof is saved.

## Two-store lifecycle evidence — 2026-08-08

- `shopops-lifecycle-a.myshopify.com`: fresh install and Growth trial approved;
  initial sync stored 2 locations and 17 products. First uninstall exposed the
  missing lifecycle subscription. After the fix, reinstall recreated one online
  and one expiring offline session (with refresh token), retained exactly 1
  membership, 2 locations, and 17 products, completed a new manual sync, and
  created no business-data duplicates. Second uninstall reduced sessions from 2
  to 0 while retaining historical data for the compliance window.
- `shopops-lifecycle-b.myshopify.com`: fresh install, Growth trial, and initial
  sync passed. It was uninstalled at 2026-08-09 01:50 UTC and must not be
  reinstalled before the scheduled post-48-hour `shop/redact` verification.
  Immediate baseline: 0 sessions, 1 membership, 2 locations, 17 products, 5
  sync runs, 0 orders, and 0 order lines.
- Local release gates after the latest live-role fixes: typecheck passed, lint
  passed, production build passed, and all 127 P0/Marketplace tests passed.
- Public live smoke on 2026-08-08: `/privacy`, `/terms`, and `/support` each
  returned HTTP 200 without an authentication redirect; navigation links are
  present and the support address is `support@shopopsstudio.com`.
- Current SDK-alignment regression: typecheck passed, lint passed after
  normalizing the generated declaration comment, production build passed,
  Shopify POS extension build passed, all 127 P0/Marketplace tests passed, and
  the production dependency audit reported zero vulnerabilities.
- Live Owner route smoke on 2026-08-08: Overview, Compare Locations, Costs,
  People, and Settings all rendered without 404/500. People showed eight
  sales-only profiles as `No access`, zero `Needs attention`, and the active
  Viewer remained scoped to Laval. Costs contained no obsolete `50% fallback`
  wording.

## Live role and plan evidence — 2026-08-08

- Manager: exactly two assigned locations (Laval and Montreal), 85 orders and
  12,499.86 CAD; direct ShopOps Plan & billing URL denied.
- Admin: all three reporting locations, 118 orders and 18,027.93 CAD; ShopOps
  Plan & billing rendered QA Pilot read-only with no plan-management action.
- Controlled plan test: the Shopify-hosted page allowed the non-owner Shopify
  staff account to approve Solo while it had Shopify's high-trust `Store
  administrator` role. The role was removed and the account now retains only
  the custom `App users` store role plus POS access; `Approve app charges` and
  app-management permissions are not selected. Development-store plans remain
  free test charges, so their approval UI is not evidence of production paid
  billing authority. ShopOps refused non-owner plan confirmation. The owner then
  selected and approved QA Pilot; ShopOps rendered QA Pilot Active with all
  three locations and both ShopOps users within plan.
- Viewer final state: Laval only, no global location picker, no Compare
  Locations, People, Costs, Settings, or ShopOps Billing; canonical database
  membership is active `viewer`, non-owner, with one Laval `can_view` grant and
  no `can_manage` grant.
- Low-risk fixes added after live discovery and deployed in stable commit
  `0938e57`: Compare Locations cost/expense CTAs are gated by `manage_costs`,
  and billing copy distinguishes ShopOps owner-only controls from
  Shopify-hosted staff billing permissions. Both fixes passed live rechecks.
- Solo capacity was live-tested end to end. The attempted synthetic user
  `capacity-test@demo-shopops.test` left zero staff, membership, and location
  grant rows after the expected rejection. All three reporting locations and
  both real ShopOps memberships were preserved before QA Pilot was restored.

## Smallest next fix scope

Do not redesign the dashboard. The smallest safe path is:

1. keep Lifecycle B uninstalled and verify the real `shop/redact` result after
   48 hours;
2. capture an authenticated embedded Dashboard performance trace and reduce the
   measured LCP if the 3,552 ms result reproduces;
3. verify Partner Dashboard scopes, protected-data declarations, public pricing,
   screencast, and listing validation;
4. capture focused Marketplace media from the proven flows;
5. run final automated pre-submission checks and submit.
