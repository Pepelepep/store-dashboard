# ShopOps delivery system

## Purpose

This system turns one approved GitHub issue into one reviewable pull request.
It does not autonomously merge, deploy, publish a Shopify version, or mutate a
production store or database.

## Delivery graph

1. **Intake:** issue outcome, acceptance criteria, risk surfaces, out-of-scope.
2. **Plan:** affected files, tests, data/security impact, rollback.
3. **Implement:** smallest scoped change on a short-lived branch.
4. **Targeted validation:** changed behavior and failure path.
5. **Repository gates:** typecheck, lint, regression tests, build, audit.
6. **UI evidence:** Playwright desktop/mobile and accessibility where relevant.
7. **Shopify evidence:** real Development Store QA for auth, billing, webhook,
   scope, installation, or embedded-admin behavior.
8. **Review:** PR evidence plus explicit untested items.
9. **Release approval:** protected GitHub environment; still no automatic
   Shopify publish or production deployment.

Failure returns work to implementation. An agent gets at most three correction
cycles before it must stop and request a decision.

## Commands

```bash
npm run delivery:classify
npm run test:unit
npm run release:verify
E2E_BASE_URL=https://your-staging-host npm run test:e2e:public
```

## GitHub configuration required once

Repository settings → Branches → protect `marketplace/stable-prep`:

- require a pull request;
- require `quality-gate / quality-gate`;
- require conversation resolution;
- block force pushes and deletion;
- require linear history;
- do not enable automatic deployment to Shopify from untrusted PRs.

Repository settings → Environments → create `shopify-release`:

- add Pierre-Paul as required reviewer;
- prevent self-review when another maintainer is available;
- restrict deployment branches to `marketplace/stable-prep`;
- keep production secrets out of general repository secrets.

Repository settings → Actions → Variables:

- `E2E_BASE_URL`: public Render staging URL used by the scheduled public smoke.

## What remains manual by design

- first install, uninstall, reinstall, and managed installation;
- billing approval, cancellation, upgrade, and downgrade;
- embedded Admin role tests;
- real webhook delivery and 48-hour redaction lifecycle;
- final Marketplace listing checks and reviewer screencast;
- Shopify app version release and production deployment.

Record these results in the PR. Never replace them with mocked or inferred
evidence.
