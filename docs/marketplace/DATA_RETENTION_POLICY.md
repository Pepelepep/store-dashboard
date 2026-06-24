# Data Retention Policy

Draft status: marketplace preparation draft. This document records proposed decisions and open alternatives.

## Current Observed Behavior

`app/uninstalled` behavior:

- The `webhooks.app.uninstalled.tsx` handler authenticates the Shopify webhook.
- It deletes Shopify sessions from Prisma for the shop.
- It does not delete shop-scoped Supabase business analytics data.

`shop/redact` behavior:

- The `webhooks.shop.redact.tsx` handler authenticates the Shopify webhook.
- It deletes shop-scoped Supabase data from reporting and operational tables.
- It deletes Shopify sessions for the shop.
- It records a minimal compliance audit event.

## Proposed Uninstall/Reinstall Policy

Recommended policy: retain shop-scoped business analytics data for 30 days after app uninstall, unless a redaction/deletion request occurs sooner.

Reasoning:

- Supports accidental uninstall recovery.
- Supports reinstall without requiring a full historical sync.
- Gives support a short window to diagnose uninstall/reinstall issues.
- Limits long-term retention after the merchant stops using the app.

Important implementation note:

- The current code does not yet enforce a 30-day deletion timer after uninstall. This is a policy recommendation and implementation decision, not current behavior.

## Alternatives

Immediate deletion:

- Pros: strongest minimization, simplest privacy story.
- Cons: accidental uninstall destroys reporting history and support context.

60-day retention:

- Pros: more reinstall/support flexibility.
- Cons: higher retention risk and harder to justify.

90-day retention:

- Pros: maximum merchant recovery window.
- Cons: materially higher review/privacy risk and likely excessive for MVP.

## Redaction and Deletion Handling

Customer data request:

- Record a safe compliance audit event.
- State that direct customer profiles are not intentionally stored in business reporting tables.
- Do not expose raw customer contact payloads in logs or support workflows.

Customer redaction:

- Redact matched order display fields when Shopify provides order IDs.
- Preserve aggregate financial records where direct customer profile fields are not stored and business analytics remain valid.

Shop redaction:

- Delete shop-scoped Supabase data for the requested shop.
- Delete Shopify sessions for that shop.
- Retain minimal compliance audit event only.

## Compliance Audit Event Retention

Recommended policy: retain minimal compliance audit events for security, audit, and platform compliance evidence.

Audit event details should remain non-sensitive:

- Shop domain.
- Topic.
- Status.
- Received timestamp.
- Error message if needed.
- Counts and safe boolean indicators rather than raw customer contact data.

Open decision: define final audit event retention window. Recommended starting point: 1 year, unless counsel recommends a different period.

## Open Decisions

- Approve 30-day post-uninstall retention or choose an alternative.
- Decide whether permissions should be preserved across reinstall or reset on uninstall.
- Decide final compliance audit event retention period.
- Decide whether to add an automated deletion job for uninstalled shops before App Store submission.
