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
| Live Owner/Admin/Manager/Viewer role QA | PARTIAL | Owner successfully changed the existing non-owner membership Viewer → Manager (two locations) → Admin (all locations) → revoked → Viewer (Laval only), with canonical DB state verified after restoration. Visibility and direct-URL denial still require signing in as that non-owner Shopify account. |
| Reporting-location lifecycle | PASSED 2026-08-08 | Laval was disabled: reporting changed from three locations/118 orders/18,027.93 CAD to two locations/85 orders/13,500.87 CAD. Re-enabling restored the exact original totals. All 225 synthetic lines remained stored and all three Shopify locations remained active. |
| Billing lifecycle | PARTIAL LIVE PASS 2026-08-08 | Two clean stores selected and approved the hosted Growth trial at $0 in development. Uninstall changed the subscription to canceling and the app rendered that state correctly after reinstall. Plan change and non-Owner denial still need live proof. |
| Fresh install/reinstall | PASSED 2026-08-08 | Two clean development stores completed install, managed OAuth, hosted pricing, first sync, reload, and uninstall. Lifecycle A also completed immediate reinstall, automatic expiring offline-token acquisition, successful post-reinstall sync, idempotent retained data, and a second uninstall. |
| Marketplace screencast | MISSING | Reviewer video shows install/onboarding, location setup, staff mapping, role behavior, reports, and billing. |
| Final listing screenshots | REPLACE | Capture dashboard-only frames after role QA, using synthetic staff and no PII. Do not expose the current Staff filter because it also lists identities from real synchronized data. |
| Automatic maintenance scheduler | PASSED 2026-08-08 | Render service `shopops-maintenance-tick` is active and completed successful maintenance runs while the two lifecycle stores synchronized. Keep it active through review. |
| Live compliance webhooks | IN PROGRESS | `app/uninstalled` was missing from the deployed Shopify configuration and was fixed in app version `shopops-studio-15`. Live retest proved both online and offline sessions drop to zero within seconds. Lifecycle B remains uninstalled from 2026-08-09 01:50 UTC for the real Shopify `shop/redact` delivery after 48 hours; an automated verification is scheduled for 2026-08-11 02:05 UTC. |

## MUST FIX / COMPLETE

| Item | Status | Next action |
| --- | --- | --- |
| Demo staff attribution | FIXED 2026-08-08 | 225/225 synthetic lines map to six synthetic sellers across three locations. Preserve via `001_staging_demo_data.sql`. |
| Viewer experience | AUTOMATED PASS; LIVE QA NEEDED | Viewer sees only assigned locations, no location-access management and no global comparison. |
| Manager experience | AUTOMATED PASS; LIVE QA NEEDED | Manager sees Overview and compares only assigned locations. |
| Admin experience | AUTOMATED PASS; LIVE QA NEEDED | Admin has global reporting and people/location administration, without Owner-only billing authority. |
| Owner-sensitive actions | AUTOMATED PASS; LIVE QA NEEDED | Verify Billing/Plan and destructive lifecycle actions separately from Admin. |
| Shopify compliance webhooks | CODE PASS; LIVE DELIVERY NEEDED | Send and verify customers/data_request, customers/redact, shop/redact with valid HMAC and inspect minimal audit records. |
| API/scopes/privacy declarations | MANUAL CONFIRMATION NEEDED | Partner Dashboard declarations must exactly match deployed scopes and Protected Customer Data/read_all_orders approvals. |
| Listing validation | INCOMPLETE | Resolve feature media, final screenshots, active pricing plans, and screencast URL. |
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
| Billing/Plan actions | Yes | No | No | No |
| See Access Location management UX | Yes | Yes | No | No |

## Exact live QA sequence

1. Sign in as Owner and record the initial three reporting locations.
2. Disable one location in ShopOps reporting settings (not in Shopify itself).
3. Confirm Dashboard totals, comparison choices, and staff tables exclude it.
4. Confirm its historical rows remain stored and no Shopify source data changed.
5. Sign in as Viewer and confirm only the assigned location is reachable by UI
   and direct URL; confirm there is no access-management or comparison UI.
6. Sign in as Manager and confirm two assigned locations are comparable while a
   third is rejected by both UI and server.
7. Sign in as Admin and confirm all locations and People/Location setup are
   available, but Billing/Plan mutation is rejected.
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
- Local release gates after the lifecycle fixes: typecheck passed, lint passed,
  production build passed, and all 126 P0/Marketplace tests passed.

## Smallest next fix scope

Do not redesign the dashboard. The smallest safe path is:

1. keep Lifecycle B uninstalled and verify the real `shop/redact` result after
   48 hours;
2. finish live non-owner Manager/Admin denial tests and Owner plan-change proof;
3. verify Partner Dashboard scopes, protected-data declarations, public pricing,
   screencast, and listing validation;
4. capture focused Marketplace media from the proven flows;
5. run final automated pre-submission checks and submit.
