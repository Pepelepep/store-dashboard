# Implement one ShopOps issue

Use this prompt in Codex or Claude Cowork after opening the repository:

```text
Implement GitHub issue <ISSUE_URL> in ShopOps Studio.

Follow AGENTS.md and CLAUDE.md. Start from the latest
marketplace/stable-prep and create one short-lived branch. Do not redo a general
audit and do not change anything outside the issue's acceptance criteria.

Before editing, return a short plan containing:
1. observable outcome and acceptance criteria;
2. affected files;
3. Shopify, tenant-isolation, data, authorization and UI risks;
4. targeted tests and rollback.

Then implement the smallest coherent change. Add a regression test for every
behavior change. Run targeted tests and npm run release:verify. For UI changes,
produce desktop/mobile evidence and check loading, empty, error and restricted
states. For Shopify auth, billing, webhook, scope or lifecycle changes, clearly
separate automated evidence from Development Store QA still required.

Correct failures at most three times. If still blocked, stop and report the
exact failure and safest decision. Never deploy, publish a Shopify version,
merge, alter production configuration, or use real merchant/customer data.

Finish by preparing a PR using .github/PULL_REQUEST_TEMPLATE.md.
```
