# ShopOps Studio — Launch-day Marketplace audit

Date: 2026-08-25

Branch audited: `marketplace/stable-prep` at `1bb0f1d`, plus the local audit fix on
`audit/marketplace-launch-day-2026-08-25`

Production origin: `https://shopops-marketplace-preview.onrender.com`

## Decision

**Conditional NO-GO.** The application code is release-quality, the public service is healthy,
and the Marketplace database is correctly isolated. Do not submit yet: four short operational
gates remain before the Shopify review button should be used.

1. Resume `shopops-maintenance-tick` and prove a fresh successful tick.
2. Release a current Shopify app version (the active version is still `shopops-studio-15` from
   2026-08-09; `shopops-studio-16-candidate` is inactive).
3. Produce the final reviewer screencast and use only polished, synthetic-data screenshots.
4. Complete the Partner Dashboard owner attestation and verify the current Protected Customer
   Data / `read_all_orders` review state before submission.

Deployment, app-version release, production configuration changes, and the final submission click
remain human-approved actions under `AGENTS.md`.

## Verified passes

### Code and release gates

- TypeScript check: pass.
- ESLint: pass.
- Automated behavior tests: 144 pass (138 P0/Marketplace, 2 staff CSV, 4 POS attribution).
- React Router production build: pass.
- Production dependency audit: 0 vulnerabilities.
- Shopify application build: pass.
- POS extension: pass, 23.6 KB original / approximately 9.1 KB compressed.
- No tracked `.env`, credential, private-key, Shopify token, Supabase secret-key, or Stripe live-key
  file/signature was found by the targeted repository scan.

Non-blocking tooling warnings:

- TypeScript 5.9 is newer than the range officially supported by the current
  `@typescript-eslint` 6.x parser.
- React Router reports four opt-in v8 future flags.
- Shopify CLI regenerates `extensions/shopops-pos-attribution/shopify.d.ts` with `@ts-ignore`;
  the tracked normalized `@ts-expect-error` form must be restored after a local Shopify build.

### Public availability

- `/`, `/privacy`, `/terms`, `/support`, and `/healthz`: live HTTP 200 over TLS.
- `/internal/health/operations`: live HTTP 401 without its bearer secret, as expected.
- `/auth/login?shop=shopops-demo.myshopify.com`: redirects to the canonical Marketplace client ID
  `751df93cb283cb05edc5b46b35de06be`.
- Embedded `/app` responses include a shop-scoped `frame-ancestors` CSP.
- Public desktop and mobile Playwright flows passed against production before the local fix.

Low-risk HTTP hardening to schedule after submission or in a separate change: public HTML responses
do not currently advertise HSTS, `X-Content-Type-Options`, or `Referrer-Policy`. Do not add
`X-Frame-Options` globally because the application must render embedded in Shopify.

### Public web performance

Chrome trace, production origin:

| Scenario | TTFB | LCP | CLS | Result |
| --- | ---: | ---: | ---: | --- |
| Desktop, unthrottled | 58 ms | 194 ms | 0.00 | Excellent |
| Mobile 412×915, Slow 4G, CPU ×4 | 53 ms | 1,254 ms | 0.00 | Good |

- No CrUX field data was available for the public page.
- Render-blocking resources had an estimated 0 ms LCP/FCP impact and are not a priority.
- The LCP resource is the 293 KB overview screenshot. It is server-rendered and not lazy-loaded.
- The local fix adds `fetchPriority="high"`; Chrome reported no quantified saving, so this is a
  small correctness improvement, not a claimed performance breakthrough.
- Lighthouse production baseline before the local fix: Accessibility 95, Best Practices 100,
  SEO 100, Agentic Browsing 100.
- The only Lighthouse failure was contrast in the decorative frame label and footer disclaimer.
  The local fix darkens both and removes the Axe color-contrast exemption. The landing page passed
  Axe with color contrast enabled on desktop and mobile locally.

Authenticated embedded performance is still a manual evidence gap. The last internal evidence says
embedded LCP p75 was approximately 3.55 s, above the 2.5 s Built for Shopify target. This does not
invalidate the excellent public baseline and is not by itself an initial App Store rejection, but
an authenticated trace should be captured before pursuing Built for Shopify.

### Supabase and tenant security

- Dedicated project confirmed: `yiurdjvxnzlbsctveowa` (`ShopOps`), active and healthy, Postgres 17.
- The live schema contains the current owner self-reclaim RPC and the POS session-attribution
  isolation behavior, even though the Supabase migration-history list does not record the two
  newest repository filenames.
- 20 legacy public-schema tables have RLS disabled. This must remain visible as a hardening issue.
  Direct verification found **zero** tables with DML privileges for `anon` or `authenticated`.
- No `SECURITY DEFINER` function is executable by `anon` or `authenticated`.
- Six RLS-enabled internal tables intentionally have no client policy and are service-role-only.
- Supabase security advisor reports informational items only; no exposed privileged RPC was found.
- Unused-index advisor entries are not a launch-day reason to drop indexes. Re-evaluate after real
  production traffic and query-plan evidence.

RLS reference: https://supabase.com/docs/guides/database/postgres/row-level-security

### Webhooks and compliance evidence

- Operational webhook queue: 225 events, all `done`.
- Compliance records: 9 `SHOP_REDACT` completed, 1 `CUSTOMERS_REDACT` completed.
- The latest completed `SHOP_REDACT` is dated 2026-08-11, matching the old Lifecycle B verification
  window, but the identity-specific proof is not reconciled into the status document.
- One `CUSTOMERS_DATA_REQUEST` received on 2026-08-09 remains open for direct merchant fulfillment.
  It must be completed within the documented 30-day workflow; do not mark it completed without
  actually producing the merchant response.

## Blocking findings

### B1 — Scheduler is suspended

Database evidence:

- Last successful maintenance tick: 2026-08-09 03:20 UTC.
- Last sync activity: 2026-08-09.
- Documentation confirms the Render cron was intentionally suspended for pre-launch QA.

Action:

1. Resume `shopops-maintenance-tick` in Render.
2. Verify a new `last_succeeded_at` within five minutes.
3. Confirm no pending/processing webhook or sync job is left stale.
4. Keep the scheduler active throughout Shopify review and production.

### B2 — Shopify version is stale

Shopify CLI verified the canonical organization and app and listed 16 deployed versions.
`shopops-studio-15` is active; `shopops-studio-16-candidate` is inactive.

Action:

1. Review candidate 16 against the current branch and POS bundle.
2. If identical, release candidate 16; otherwise create a fresh candidate from the reviewed commit.
3. Smoke install, OAuth, uninstall/reinstall, POS tile availability, and webhooks on the demo shop.
4. Record the released version name and timestamp in the submission notes.

### B3 — Listing media is not fully final

The three core source images are synthetic and correctly sized, but the broader 11-image set must
not be uploaded blindly.

Do not upload these states:

- `11-data-sync-1600x900.png`: explicitly shows `Delayed automatic check`.
- `08-sales-attribution-1600x900.png` and `09-location-access-1600x900.png`: contain visibly blurred
  identities; use wholly synthetic identities instead of visible redactions.
- `10-plan-billing-1600x900.png`: shows private `QA Pilot`, not the public offer.
- `03-costs-1600x900.png`: the title is cropped and helper text visibly runs together.
- `02-compare-locations-1600x900.png`: contains the generic `Shop location` label.

Action:

1. Resume maintenance and capture an `Active` synchronization state.
2. Use only clearly fictional shop, location, person, email, order, and expense data.
3. Capture Overview, Compare Locations, Costs, Data sync/quality checks, and public plan selection
   with consistent dates and browser framing.
4. Avoid extreme comparison percentages caused by an almost-empty prior period.
5. Record a 3–8 minute reviewer screencast covering install, billing, sync, roles, reports, POS tile,
   and support/legal pages.

### B4 — Dashboard-only attestations

The repository evidence says the Protected Customer Data questionnaire reached 9/9 and that final
approval happens with Shopify review. The current Partner Dashboard state could not be independently
read during this audit because the browser security policy denied Dashboard access.

Action before submission:

- Confirm the protected-data form is complete and compatible with `read_all_orders`.
- Confirm all automated App Store checks are green.
- Confirm emergency email and any mandatory phone field.
- Confirm support inbox monitoring and allow-list `noreply@shopify.com`.
- Confirm listing copy matches the current UI. In particular, the UI calls the feature `Data sync`
  with `Data quality checks`; the draft listing repeatedly promises a standalone `Data Health` page.
- Confirm the reviewer shop, owner login path, POS Smart Grid tile, and demo data.

## Launch sequence

1. Merge/deploy the accessibility fix after review.
2. Resume Render maintenance and collect fresh health evidence.
3. Release the current Shopify version and smoke the demo store.
4. Capture the final screenshots and screencast from the released version.
5. Re-run `npm run release:verify`, `shopify app build`, live public E2E, and an authenticated smoke.
6. Complete Partner Dashboard checks and owner attestation.
7. Submit once, with the reviewer script, test-shop instructions, POS Smart Grid instructions, scope
   justification, pricing behavior, and support contact ready.

## Rollback boundaries

- Accessibility fix: revert the three-file local diff and redeploy the previous Render commit.
- Scheduler: suspend the Render cron again if it produces repeated failures; preserve the failed-run
  evidence and do not delete queue records.
- Shopify version: release the last known-good app version; do not alter client production configs.
- Database: no database mutation was made by this audit. Do not mass-enable RLS without a reviewed
  policy/grant migration because doing so would block the server-side service-role access model if
  privileges are changed incorrectly.
