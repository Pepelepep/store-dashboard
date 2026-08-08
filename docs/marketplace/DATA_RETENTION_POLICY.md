# Data Retention Policy

Status: approved first-submission policy.

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

## Uninstall/Reinstall Policy

ShopOps Studio may retain shop-scoped business analytics data for no more than 30 days after app uninstall, unless Shopify's `shop/redact` webhook or another valid deletion request requires deletion sooner. A successful `shop/redact` request deletes the data immediately and therefore takes precedence over the recovery window.

Reasoning:

- Supports accidental uninstall recovery.
- Supports reinstall without requiring a full historical sync.
- Gives support a short window to diagnose uninstall/reinstall issues.
- Limits long-term retention after the merchant stops using the app.

The primary deletion mechanism is Shopify's mandatory `shop/redact` lifecycle webhook. Operations must monitor failed compliance events and complete any failed deletion manually. If the application ever retains data beyond Shopify's redaction lifecycle, a separate 30-day cleanup job must be deployed before that behavior is enabled.

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

Minimal compliance audit events are retained for one year. They contain status, timestamps, safe counts/booleans and bounded error details, not raw customer contact values or webhook payloads.

## Reinstall and Permissions

Permissions may remain during the short recovery window so an accidental reinstall can recover the previous ShopOps configuration. They are deleted by `shop/redact`. OAuth sessions and billing cache are always removed immediately on uninstall, so reinstall requires a fresh Shopify authentication and fresh billing verification.
