## Outcome

<!-- What merchant/user outcome does this PR deliver? -->

## Scope

- Issue:
- Included:
- Explicitly excluded:

## Acceptance evidence

- [ ] Acceptance criteria are satisfied
- [ ] Regression tests cover the changed behavior
- [ ] `npm run release:verify` passes

## Shopify risk check

- [ ] No Shopify auth/session/scope change
- [ ] No billing or entitlement change
- [ ] No webhook/compliance/uninstall/redaction change
- [ ] No protected customer data change
- [ ] No Shopify app configuration/version change

Explain every unchecked item and link its targeted test evidence:

## Data and security check

- [ ] Tenant queries remain scoped by `shop_domain`/authenticated shop
- [ ] Authorization is enforced server-side
- [ ] No secret or personal data was added to code, logs, fixtures, or media
- [ ] No migration/RLS/privileged RPC change

Explain every unchecked item and include rollback steps:

## UI evidence

- [ ] Not applicable
- [ ] Desktop checked
- [ ] Mobile checked
- [ ] Loading/empty/error/restricted states checked
- [ ] Accessibility checked

Screenshots or preview URL:

## Validation

| Gate | Result | Evidence |
| --- | --- | --- |
| Typecheck | | |
| Lint | | |
| Unit/regression tests | | |
| Build | | |
| Dependency audit | | |
| Shopify dev-store QA | | |

## Remaining manual checks

<!-- Never mark an unexecuted Shopify dev-store check as passed. -->

## Rollback

<!-- Exact safe rollback procedure. -->
