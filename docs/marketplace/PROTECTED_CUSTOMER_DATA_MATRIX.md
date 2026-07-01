# Protected Customer Data Matrix

Draft status: marketplace preparation draft.

| Data category | Shopify source/scope | Stored fields | Purpose | Direct customer data stored? | Retention | Deletion/redaction handling | Risk level | Notes |
|---|---|---|---|---|---|---|---|---|
| Shop/session data | OAuth/session storage | Shop domain, session ID, access token, scopes, user/session metadata | Authentication and offline API access | No direct customer data | Active install; sessions deleted on uninstall and shop redaction | `app/uninstalled` deletes sessions; `shop/redact` deletes sessions | Medium | Access tokens are sensitive secrets |
| Locations | `read_locations` | Location ID, name, active status, metadata | Location reporting, filters, permissions, expenses | No | Active install; proposed 30 days after uninstall unless deletion request | Deleted by `shop/redact` | Low | Merchant operational data |
| Products | `read_products` | Product ID, title, vendor, status | Product reporting, vendor analytics, joins | No | Active install; proposed 30 days after uninstall unless deletion request | Deleted by `shop/redact` | Low | Commercially sensitive merchant data |
| Variants/SKUs | `read_products` | Variant ID, product ID, title, SKU, inventory item ID, unit cost | SKU reporting, COGS, inventory joins | No | Active install; proposed 30 days after uninstall unless deletion request | Deleted by `shop/redact` | Low/Medium | Unit cost is sensitive merchant financial data |
| Inventory levels | `read_inventory` | Location ID, variant ID, inventory item ID, SKU, available quantity, tracked status | Stock alerts and operations reporting | No | Active install; proposed 30 days after uninstall unless deletion request | Deleted by `shop/redact` | Low | Merchant operational data |
| Inventory item cost | `read_inventory` | Inventory item ID, unit cost, synced timestamp | COGS and margin reporting | No | Active install; proposed 30 days after uninstall unless deletion request | Deleted by `shop/redact` | Medium | Sensitive merchant cost data |
| Orders | `read_orders`, `read_all_orders` | Order ID, order display name, created timestamp, financial status, financial totals, shipping amount, nullable staff attribution fields where available | Sales, refund, return, and financial reporting | Not intentionally; no customer profile/contact fields in reporting tables | Active install; proposed 30 days after uninstall unless deletion request | Customer redaction anonymizes matched order names; `shop/redact` deletes shop data | High | Order history may be protected/sensitive; `shipping` is a shipping amount, not a customer address; `staff_member_email` is staff attribution, not customer email |
| Order lines | `read_orders`, `read_all_orders`, `read_products` | Line item ID, order ID/name, product/variant/SKU, quantity, prices, discounts, returns, COGS, gross profit, nullable staff attribution fields where available | Product/location/staff/financial analytics | Not intentionally; no customer profile/contact fields in reporting tables | Active install; proposed 30 days after uninstall unless deletion request | Customer redaction anonymizes matched order names; `shop/redact` deletes shop data | High | Links to order history; `staff_member_email` is staff attribution, not customer email |
| Transactions/refunds/returns | `read_orders`, `read_all_orders` | Transaction ID, order ID, kind, status, amount, processed timestamp, refund/return metrics | Refund, return, and net sales reporting | Not intentionally | Active install; proposed 30 days after uninstall unless deletion request | Deleted by `shop/redact`; aggregate records may remain until deletion | High | Financial transaction data is sensitive |
| Staff/user metadata | Future/custom only; public app does not request `read_users` | Staff/user ID, name, email where previously available or future custom/Plus sync provides it, active status | Optional suggestions and future staff directory sync | No customer data; staff personal data yes | Active install; proposed 30 days after uninstall unless deletion request | Deleted by `shop/redact` | Medium | `staff_members` table is retained for future custom/Plus support; not required for public app permissions |
| App permissions | App-created data | User email, Shopify user ID from current session where available, role, location access, can view/manage | App access control | No customer data; staff personal data may be stored | Active install; proposed 30 days after uninstall unless deletion request | Deleted by `shop/redact`; open decision whether uninstall should reset | Medium | `user_email` is a staff/app permission identity, not customer email |
| Fixed expenses | Merchant-entered app data | Expense name, category, amount, location, start/end month, active status | Expense and net profit reporting | No | Active install; proposed 30 days after uninstall unless deletion request | Deleted by `shop/redact` | Low/Medium | Merchant financial data |
| Sync jobs/runs | App operational data | Sync type, status, source, timestamps, error messages, details/counts | Monitoring and troubleshooting | Should not include direct customer data | Active install; proposed 30 days after uninstall unless deletion request | Deleted by `shop/redact` | Medium | Error messages should avoid raw payloads |
| Operational webhook events | Shopify webhooks | Shop, topic, webhook ID, resource IDs, payload, status, attempts, errors | Incremental sync processing and retries | Payloads may include order/product/inventory data; avoid customer contact logging | Active install; proposed 30 days after uninstall unless deletion request | Deleted by `shop/redact` | High | Payload retention should be minimized |
| Compliance webhook events | Shopify compliance webhooks | Shop, topic, status, timestamp, safe details, error | Compliance audit trail | Should not store raw customer contact data | Open decision; recommended 1 year minimal audit retention | Retained minimally after `shop/redact` | Medium | Must remain non-sensitive |

## Summary

The highest-risk data categories are orders, order lines, transactions/refunds/returns, and operational webhook payloads. The app should continue minimizing direct customer profile fields and should avoid storing customer names, customer addresses, customer phone numbers, and customer emails in business reporting tables.

No individual protected customer field access is needed for the public listing because customer name, address, email, and phone are not displayed or stored in reporting tables. Protected Customer Data review remains in Draft and will be reviewed with the App Store listing.

Compliance webhook behavior:

- `customers/data_request`, `customers/redact`, and `shop/redact` validate Shopify HMAC through Shopify webhook authentication.
- Valid compliance webhook requests return 200.
- Invalid HMAC requests return 401.

Open decisions:

- Approve final retention periods.
- Decide whether operational webhook payloads need shorter retention after processing.
- Confirm final retention periods.
