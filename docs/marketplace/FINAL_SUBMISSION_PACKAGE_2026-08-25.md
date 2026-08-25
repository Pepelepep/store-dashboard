# ShopOps Studio — Final Submission Package

Prepared: 2026-08-25
Status: ready for the final owner-operated demo, Partner Dashboard confirmations, and submission.

## 1. Review Screencast

Record a real end-to-end use of the app inside Shopify Admin and Shopify POS. Do not submit a text-only marketing video. A simple screen recording with an English voice-over or accurate English subtitles is sufficient; background music and face camera are unnecessary.

Target length: 4–6 minutes. Use demo data only, keep the browser zoom readable, and pause briefly after each action so the reviewer can follow it.

### Recommended shot list

1. **Install and permissions — 30–45 seconds**
   - Start from the Shopify test-install link or Partner Dashboard install action.
   - Show the requested scopes and approve installation.
   - Show the Shopify App Pricing approval/trial screen if Shopify presents it.
   - Confirm that ShopOps Studio opens embedded in Shopify Admin.
2. **First run and data readiness — 30–45 seconds**
   - Show the initial preparation state or Sync Center.
   - Explain that jobs run in the background and that the reviewer can continue after data becomes ready.
   - Show the last successful sync and the healthy data-readiness state.
3. **Core reporting — 60–90 seconds**
   - Open Overview, choose a seeded date range and a location.
   - Show sales, profit/margin, best sellers, inventory risk, refunds/returns, and the sales trend.
   - Open Compare Locations and demonstrate a date/location filter change.
4. **Costs and access control — 45–60 seconds**
   - Show COGS/operating expenses with demo-only values.
   - Show People as Owner/Admin, then the scoped experience for Manager and Viewer.
   - State that Viewer cannot open People, Costs, Sync, Settings, Billing, or all-location comparison.
5. **Shopify POS attribution — 60–90 seconds**
   - In Shopify Admin, show **Point of Sale > Settings > POS app > Smart Grid** and the ShopOps tile on the template assigned to the review location.
   - In Shopify POS, sign in as demo staff, add a product, open the ShopOps tile/status, and complete one clearly named test sale.
   - Return to ShopOps Studio after sync and show the new sale in People > Sales attribution.
6. **Support and close — 15–30 seconds**
   - Open Support, Privacy, and Terms from the public site or app.
   - End on the dashboard and show `support@shopopsstudio.com`.

### Recording rules

- Use English narration or English subtitles.
- Hide bookmarks, passwords, notifications, tokens, private Partner Dashboard identifiers, and real merchant/customer data.
- Do not speed through installation, billing, POS setup, or role permissions.
- Do not make performance, financial-accuracy, or business-outcome guarantees.
- Upload the final video to an accessible unlisted URL and test it in a private browser window before submission.

## 2. Protected Customer Data — Proposed Partner Dashboard Answers

### Access selection

- Request access to **order data** because order history and transaction information power operational reporting.
- Do **not** request the individual customer fields **Name**, **Address**, **Email**, or **Phone**. ShopOps Studio does not intentionally request, display, or persist them in reporting tables.
- Request `read_all_orders` for historical reporting beyond Shopify's recent-order window.

### Purpose of protected order data

> ShopOps Studio reads order, order-line, transaction, refund, and return data to provide shop-scoped operational reporting for sales, discounts, COGS, gross profit, margins, returns, inventory performance, products, vendors, staff attribution where available, and location comparisons. The data is used only to provide reporting to the installing merchant. It is not sold, used for advertising, or shared for third-party marketing. ShopOps Studio does not intentionally request or store customer name, address, email, or phone in its reporting tables.

### `read_all_orders` justification

> ShopOps Studio provides historical sales, margin, COGS, discount, refund, return, vendor, product, staff-attribution, and location reporting. Merchants need to backfill orders and compare reporting periods beyond Shopify's standard recent-order window after installation. Historical orders are used only for the installing merchant's operational reporting, are isolated by shop, and are not sold or used for third-party marketing.

### Data minimization and security

> ShopOps Studio requests the minimum Shopify scopes needed for reporting. Data is isolated by shop, encrypted in transit and at rest, and access is limited to authorized application services and personnel supporting the service. Production secrets are not stored in source control. Operational logs and compliance records avoid unnecessary customer contact data. The app validates Shopify webhook authentication and implements customers/data_request, customers/redact, and shop/redact.

### Retention and deletion

> Shop-scoped reporting data is retained while the app is installed. Following uninstall, Shopify's shop/redact webhook deletes shop data after the permitted reinstall window, and a valid deletion request is handled through the mandatory compliance webhooks. Successful operational webhook history is minimized and cleaned after 30 days. Minimal non-sensitive compliance audit records may be retained for one year without raw customer contact values.

### Merchant benefit

> Access lets merchants compare historical performance, understand margins and COGS, monitor refunds and returns, identify product and inventory trends, and compare locations without exporting and manually combining Shopify reports.

## 3. Reviewer Instructions — Values to Confirm Before Submission

Use `REVIEWER_TEST_SCRIPT.md` as the step-by-step script and confirm these owner-supplied values in Partner Dashboard:

- demo store: `shopops-demo.myshopify.com`, or replace it with the final review store;
- install/test link for the Marketplace registration;
- a seeded date range containing demo orders;
- review location and POS Smart Grid template;
- demo POS staff identity and one disposable test product/order;
- safe method or accounts for demonstrating Owner, Admin, Manager, and Viewer;
- expected initial-sync duration observed during the final reinstall;
- unlisted screencast URL;
- monitored support and emergency contact: `support@shopopsstudio.com`;
- no separate non-Shopify login credentials are expected.

## 4. Final Owner-Operated Gate

- Reinstall on the final demo store and complete OAuth.
- Approve the trial/billing contract and verify the callback.
- Wait for the initial sync; record the observed duration and confirm the latest successful job.
- Add the ShopOps POS tile to the Smart Grid template assigned to the review location.
- Complete one new signed-in POS test sale and verify attribution after sync.
- Verify Owner, Admin, Manager, and Viewer behavior against `REVIEWER_TEST_SCRIPT.md`.
- In Partner Dashboard, submit Protected Customer Data and `read_all_orders` using the proposed answers above; record the approval state.
- Upload the final screenshots and screencast, test every URL in a private browser window, run Shopify's automated pre-submission checks, and resolve all findings.
- Only then select **Submit for review**.
