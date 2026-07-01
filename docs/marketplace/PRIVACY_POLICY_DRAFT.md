# Privacy Policy Draft

Draft status: marketplace preparation draft, not legal advice. This document should be reviewed by counsel before publication or App Store submission.

## Overview

ShopOps Studio is a Shopify embedded app that helps merchants understand store operations across locations. It syncs Shopify operational data into reporting tables so merchants can review sales, margins, inventory, refunds, returns, best-effort staff attribution, fixed expenses, sync health, and data quality.

## Data We Collect and Process

ShopOps Studio collects or processes the following categories of data for the merchant's shop:

- Shop, domain, and session data: shop domain, Shopify session tokens, OAuth/session metadata, and app authentication records.
- Locations: Shopify location IDs, names, active status, and location metadata used for location-level reporting.
- Products, variants, vendors, and SKUs: product IDs, product titles, vendor names, variant IDs, variant titles, SKUs, product status, and related product metadata.
- Inventory and inventory item cost: inventory item IDs, inventory levels, available quantity, tracked status, unit cost, and cost snapshots used for margin reporting.
- Orders and order lines: order IDs, order display names, order timestamps, line item IDs, products, variants, quantities, prices, discounts, returns, taxes, shipping amount, revenue, COGS, gross profit, nullable staff attribution fields where available, and related reporting fields.
- Refunds, returns, and transactions: transaction IDs, transaction kind/status, processed timestamp, refund amounts, returned quantities, and order-level financial fields.
- App permission identities: staff email entered by merchant admins, Shopify user ID from the current embedded app session where available, role, and location assignments.
- Optional staff/user metadata: existing or future custom/Plus staff directory data such as Shopify staff/user IDs, names, email addresses where available, active status, and related metadata used only for optional suggestions and future advanced staff sync.
- Expenses configured in the app: fixed expense names, categories, monthly amounts, assigned locations, active status, start month, and end month.
- Sync, job, webhook, and compliance logs: sync runs, sync jobs, webhook event metadata, webhook topics, processing status, error messages, compliance webhook audit events, and non-sensitive compliance details.

## Customer Data Minimization

ShopOps Studio does not intentionally store direct customer profiles, customer names, customer addresses, customer phone numbers, or customer emails in business reporting tables. No individual protected customer field access is needed for those fields because they are not displayed or stored in reporting tables.

`orders.shipping` is a shipping amount, not a customer shipping address. `orders.staff_member_email`, `order_lines.staff_member_email`, and `user_location_access.user_email` are staff/app permission fields, not customer email fields.

Order history, order display names, order line details, transaction data, refunds, returns, and financial reporting data may still be considered sensitive or protected data under Shopify policies or applicable law. ShopOps Studio uses this data only to provide merchant-facing operational reporting and analytics.

## How We Use Data

We use merchant shop data to:

- Provide store, location, product, best-effort staff attribution, and financial reporting.
- Calculate sales, COGS, gross profit, gross margin, expenses, and net profit.
- Show inventory and stock alert insights.
- Support permission-controlled access by staff email and location.
- Process Shopify webhooks for incremental updates.
- Diagnose sync failures and data quality issues.
- Respond to Shopify compliance webhook events.

## Data Sharing

Draft policy decision: ShopOps Studio should not sell merchant or customer data. Data should be shared only with infrastructure providers required to operate the app, such as hosting, database, logging, and Shopify platform services.

Specific subprocessors and infrastructure providers must be listed before publication.

## Deletion and Redaction

ShopOps Studio handles Shopify compliance webhooks at draft level as follows:

- `customers/data_request`: records a safe audit event and notes that direct customer profile export is not implemented because direct customer profiles are not intentionally stored.
- `customers/redact`: redacts matched order display fields where Shopify provides order IDs, while preserving aggregate financial totals needed for merchant analytics.
- `shop/redact`: deletes shop-scoped business analytics data and Shopify sessions for the requested shop, while retaining a minimal compliance audit event.

Compliance webhook routes validate Shopify HMAC through Shopify webhook authentication. Valid compliance webhook requests return 200; invalid HMAC requests return 401.

Uninstall behavior is documented separately in `DATA_RETENTION_POLICY.md`. Draft recommendation: app uninstall deletes Shopify sessions immediately and temporarily retains shop-scoped analytics data for reinstall/support unless a redaction/deletion request occurs.

## Security

ShopOps Studio uses server-side authentication, Shopify OAuth sessions, Shopify webhook authentication, and internal bearer-secret protection for cron/internal endpoints. Production security controls and incident response procedures should be finalized before publication.

## Merchant Responsibilities

Merchants are responsible for:

- Ensuring they are authorized to install and use the app.
- Managing staff access and app permissions.
- Reviewing exported or reported data before using it for business, tax, accounting, or legal purposes.

## Contact

Support email: `support@shopopsstudio.com`  
Emergency contact: `[emergency contact placeholder]`

## Draft Notice

This privacy policy is a draft for marketplace readiness planning. It is not legal advice and should not be published without legal and business review.
