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
| Live Owner/Admin/Manager/Viewer role QA | BLOCKED | Four real sign-in identities (or Shopify staff accounts) complete the role matrix below. Fake seed emails are reporting identities, not login accounts. |
| Reporting-location lifecycle | NOT RUN | Enable one synced location, verify it appears in Dashboard/Locations and role scopes; disable it, verify it disappears without deleting historical Shopify data; re-enable and verify recovery. |
| Billing lifecycle | NOT RUN | Owner starts trial, approves charge, changes plan, cancels; Admin/Manager/Viewer cannot perform Billing/Plan actions. Only then enable public Partner Dashboard plans. |
| Fresh install/reinstall | NOT RUN | Clean development store: install, OAuth, onboarding, first sync, reload, uninstall, reinstall, and retained/deleted state verified. |
| Marketplace screencast | MISSING | Reviewer video shows install/onboarding, location setup, staff mapping, role behavior, reports, and billing. |
| Final listing screenshots | REPLACE | Capture dashboard-only frames after role QA, using synthetic staff and no PII. |

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

## Smallest next fix scope

Do not redesign the dashboard. The smallest safe path is:

1. complete live location enable/disable/re-enable QA;
2. provision or identify one real login for each non-owner role;
3. execute the role matrix and fix only observed failures;
4. execute billing and fresh-install lifecycle;
5. capture focused Marketplace media from the now-proven flows;
6. enable Partner Dashboard pricing and submit.
