# ShopOps Studio agent rules

These rules apply to Codex, Claude Cowork, and any other coding agent working in
this repository.

## Branch and scope

- Start from `marketplace/stable-prep`.
- Work on one short-lived branch and one issue at a time.
- Never commit or merge Marketplace work to `main`.
- Do not deploy, publish a Shopify app version, merge a pull request, alter
  production configuration, or write production data without Pierre-Paul's
  explicit approval.
- Treat the issue acceptance criteria as the scope boundary. Record additional
  findings instead of silently expanding the change.

## Protected surfaces

Changes to any of the following require explicit risk notes, targeted tests,
and manual approval:

- Shopify authentication, sessions, scopes, billing, webhooks, and app config;
- Supabase migrations, RLS, privileged functions, tenant filters, and service
  role access;
- permissions, role capabilities, location access, or plan entitlements;
- sync, queue, cron, deletion, redaction, or uninstall behavior;
- production secrets, Render configuration, and deployment workflows.

Never use real merchant or customer data in tests, screenshots, logs, prompts,
or fixtures.

## Delivery loop

1. Read the issue, relevant docs, and surrounding code.
2. Write a concise implementation and test plan before editing.
3. Make the smallest coherent change.
4. Add or update a regression test for every behavior change or bug fix.
5. Run targeted tests, then `npm run release:verify`.
6. For UI changes, run the relevant Playwright flow and attach desktop/mobile
   evidence. Check loading, empty, success, error, and restricted states.
7. Review the diff for tenant isolation, authorization, privacy, idempotency,
   retries, and rollback safety.
8. Correct failures at most three times. If the same gate still fails, stop and
   report the blocker, evidence, and safest next decision.
9. Open a PR using the repository template. Never self-declare a manual Shopify
   QA step as passed.

## Definition of done

- Acceptance criteria are demonstrably satisfied.
- Tests cover the changed behavior and failure path.
- Typecheck, lint, unit tests, build, and dependency audit pass.
- Sensitive Shopify/Supabase changes have targeted evidence and a rollback.
- UI changes include screenshots and an accessibility review.
- Documentation and configuration examples match the implementation.
- The PR states what was not tested and what still needs human verification.
