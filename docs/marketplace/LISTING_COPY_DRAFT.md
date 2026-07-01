# ShopOps Studio App Store Listing Package

Status: Phase 7A first-submission-ready listing copy.

## App Name

ShopOps Studio

## Short Tagline

Shopify reporting for margins, COGS, refunds, returns, discounts, and Data Health.

## App Store Subtitle

Merchant-facing reporting for store performance, margins, COGS, and data readiness.

## Short Description

ShopOps Studio gives Shopify merchants a clearer view of store performance with reporting for sales, margins, COGS, refunds, returns, discounts, inventory, expenses, staff attribution, permissions, and Data Health.

## Full Description

ShopOps Studio is a Shopify reporting app for merchants who need operational visibility beyond top-line sales.

Use ShopOps Studio to review location performance, product and vendor trends, COGS, estimated gross profit, gross margin, discounts, refunds, returns, fixed expenses, inventory signals, and staff-attributed sales where Shopify provides staff data. Data Health helps admins understand whether reporting inputs are synced, complete, and ready to review.

The app is designed for Shopify retailers with physical stores, pop-ups, warehouses, or location-based teams that want merchant-facing reporting inside Shopify. Reports are informational and intended to support operational review. ShopOps Studio does not provide accounting, tax, legal, payroll, or financial advice, and merchants remain responsible for validating reporting outputs with their own systems and advisors.

## Key Benefits

- Understand sales, margins, COGS, discounts, refunds, and returns in one Shopify embedded app.
- Compare performance across locations using synced order, product, inventory, and expense data.
- Identify margin gaps with product cost and gross profit reporting.
- Review fixed expenses by location or globally to support operational profitability views.
- Monitor report readiness with Data Health checks for sync freshness, missing costs, and data gaps.
- Control internal access with location-aware staff permissions.
- Keep reporting merchant-facing, operational, and informational.

## Feature List

- Dashboard overview with sales, net sales, COGS, gross profit, gross margin, expenses, and net profit metrics.
- Location performance reporting for stores, pop-ups, warehouses, or other Shopify locations.
- Product, SKU, vendor, and best-seller reporting.
- Inventory visibility and low-stock signals.
- Discount, refund, return, and transaction-aware reporting where synced Shopify data is available.
- Fixed expense management for global and location-specific expenses.
- Sales by Staff reporting where staff attribution is available from Shopify.
- Location-based staff permissions for internal access control.
- Data Health page for sync freshness, missing product costs, financial completeness, and reporting gaps.
- Sync Center for admin/support diagnostics during setup and troubleshooting.
- Shopify compliance webhook handling for customer, shop, and data erasure requests.

## Pricing Copy

First submission plan:

- Plan name: ShopOps Studio
- Price: `$59.99/month`
- Trial: 14 days
- Billing: Shopify managed app subscription

Suggested pricing description:

ShopOps Studio is available for `$59.99/month` after a 14-day free trial. Billing is managed through Shopify. Reports are merchant-facing and informational, and merchants remain responsible for validating financial outputs in their accounting, tax, legal, payroll, or financial systems.

Implementation note:

- Billing code is prepared but remains disabled by default with `BILLING_ENABLED=false` until the marketplace submission flow is ready for billing review.

## Support Details

- Support email: `support@shopopsstudio.com`
- Expected response time: within 2 business days.
- Security and privacy requests are prioritized.
- Merchants should include their shop domain, affected page, issue details, and screenshots when useful.
- Merchants should avoid sending unnecessary customer personal data in support requests.

## Public URLs

- Privacy: `https://shopops-marketplace-preview.onrender.com/privacy`
- Terms: `https://shopops-marketplace-preview.onrender.com/terms`
- Support: `https://shopops-marketplace-preview.onrender.com/support`

## Suggested Categories

- Analytics
- Reporting
- Store management
- Inventory management
- Finances

## Suggested Search Keywords

- Shopify reporting
- sales reporting
- margin reporting
- COGS
- cost of goods sold
- gross profit
- gross margin
- refunds
- returns
- discounts
- location reporting
- store performance
- inventory reporting
- Data Health
- Shopify analytics
- retail operations
- staff permissions
- expense tracking

## Reviewer Note

ShopOps Studio is a merchant-facing reporting app for Shopify operational data. Reports are informational and do not provide accounting, tax, legal, payroll, or financial advice.

Requested data access supports the app's reporting and permission features:

- `read_orders` is needed to report sales, line items, products sold, discounts, refunds, returns, transactions, location performance, staff attribution where available, and order-level reporting completeness.
- `read_all_orders` is needed so merchants can review historical trends, backfill reporting after install, and compare performance across reporting periods beyond Shopify's standard recent order access window.
- `read_users` is needed to identify Shopify staff users for staff attribution and to support staff/location permission assignment inside the app.
- Protected customer and order data may be processed because Shopify order records can include customer/order information needed to calculate and validate merchant-facing sales, refund, return, discount, product, location, and margin reports.

ShopOps Studio isolates synced data by shop. Data is used to provide reporting, diagnostics, support, compliance, and app functionality for the installing merchant. ShopOps Studio does not sell merchant, customer, or order data and does not share it for third-party marketing.

Protected Customer Data, `read_all_orders`, and `read_users` approval is still pending for first submission.
