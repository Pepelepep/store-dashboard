# Review one ShopOps pull request

```text
Review pull request <PR_URL> against its issue and AGENTS.md. Do not implement
changes during the first pass.

Inspect only the PR diff plus the code needed to validate it. Prioritize:
1. tenant isolation and shop_domain scoping;
2. server-side authorization and role/plan bypasses;
3. Shopify auth, sessions, scopes, billing and webhook verification;
4. compliance, deletion, redaction and protected data;
5. idempotency, retries, queues, sync and financial correctness;
6. regression coverage, UI states, responsive behavior and accessibility;
7. unnecessary complexity or scope expansion.

Return findings grouped as BLOCKER, MUST FIX, SHOULD FIX and POLISH. Every
finding must cite a file and explain the concrete failure scenario. Do not pad
the review with generic advice. If no blocker exists, state which manual
Shopify Development Store checks remain required before merge or release.
```
