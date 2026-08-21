# ShopOps Studio Privacy Policy

**Last updated: August 19, 2026**

This Privacy Policy explains how ShopOps Studio ("**ShopOps Studio**," "**we**," "**us**," or
"**our**") collects, uses, discloses, and protects information in connection with the ShopOps
Studio application (the "**App**") that merchants install from the Shopify App Store.

ShopOps Studio is operated by Pierre-Paul Quilichini, based in Québec, Canada. If you have
questions about this policy or about how your data is handled, contact us at
[support@shopopsstudio.com](mailto:support@shopopsstudio.com).

This policy applies to merchants who install the App ("**Merchant**," "**you**") and, where
applicable, to end customers of those merchants whose order data passes through the App as part
of providing the Service. It does not apply to websites, apps, or services operated by third
parties, including Shopify Inc. itself; Shopify's own handling of data is governed by
[Shopify's Privacy Policy](https://www.shopify.com/legal/privacy).

## 1. Scope and role

ShopOps Studio is a data processor/service provider acting on the Merchant's behalf and on the
Merchant's instructions with respect to the Shopify store data described below. The Merchant
remains the data controller for its store's customer and business data. Where this policy uses
terms defined by applicable law (for example "personal information," "controller," "processor,"
or "service provider"), those terms carry the meaning given to them by the law that applies to
you, including the *Act Respecting the Protection of Personal Information in the Private Sector*
(Québec) ("**Law 25**"), the federal *Personal Information Protection and Electronic Documents
Act* ("**PIPEDA**"), the EU/UK General Data Protection Regulation ("**GDPR**"), and the
California Consumer Privacy Act as amended ("**CCPA**"), to the extent any of these apply to a
given Merchant or transaction.

## 2. Information we collect

To provide the Service, ShopOps Studio syncs and stores the following categories of data from
the Merchant's Shopify store, scoped to that Merchant's shop:

- **Shop and session data:** shop domain, Shopify session tokens, OAuth/session metadata, and
  app authentication records.
- **Locations:** Shopify location IDs, names, active status, and related metadata.
- **Products, variants, vendors, and SKUs:** product IDs, titles, vendor names, variant IDs,
  titles, SKUs, status, and related product metadata.
- **Inventory and cost data:** inventory item IDs, inventory levels, available quantity, tracked
  status, unit cost, and cost snapshots used to calculate margin.
- **Orders and order lines:** order IDs, display names, timestamps, line items, products,
  variants, quantities, prices, discounts, returns, taxes, shipping amount, revenue, cost of
  goods sold, gross profit, and (where available) staff-attribution fields.
- **Refunds, returns, and transactions:** transaction IDs, kind/status, processed timestamps,
  refund amounts, returned quantities, and related financial fields.
- **App permission identities:** staff email addresses entered by Merchant administrators, the
  Shopify user ID of the currently signed-in embedded-app session where available, role, and
  location assignments.
- **Optional staff/user metadata:** where a Merchant's plan supports it, Shopify staff/user IDs,
  names, and email addresses used only for staff-sales attribution and access administration.
- **Expenses configured in the App:** names, categories, monthly amounts, assigned locations,
  and effective date ranges of fixed expenses the Merchant enters.
- **Sync, job, webhook, and compliance logs:** technical records of sync runs, queued jobs,
  webhook events, processing status, error messages, and compliance webhook audit events.

**We do not intentionally collect, store, or display direct customer profile fields.** Customer
name, mailing address, phone number, and email address are not stored in ShopOps Studio's
reporting tables. `orders.shipping` is a shipping *amount*, not a customer address, and
`staff_member_email` / `user_email` fields identify staff or app users, not customers.

We do not use cookies or browser local storage to authenticate you; the App uses Shopify session
tokens exchanged through Shopify's App Bridge, consistent with Shopify's platform requirements.

## 3. How we use information

We use the data described above to:

- provide sales, margin, cost-of-goods-sold, inventory, and location reporting inside the
  Shopify Admin;
- calculate gross profit, gross margin, net profit, and related operational metrics;
- keep reports current through Shopify webhooks and scheduled syncs;
- administer role- and location-based permissions that Merchant administrators configure;
- diagnose sync failures and data-quality issues;
- verify and enforce the Merchant's Shopify App Pricing subscription; and
- receive and respond to Shopify's mandatory privacy webhooks (described in Section 6).

We do not use Merchant or customer data to train third-party AI/ML models, and we do not sell
personal information, as that term is defined under the CCPA. We do not share Merchant or
customer data for cross-context behavioral advertising.

## 4. Legal basis for processing

Where GDPR applies, we (and the Merchant, as controller) rely on the following legal bases:
performance of the contract between the Merchant and ShopOps Studio (Art. 6(1)(b)); the
Merchant's legitimate interest in operating and understanding its own business (Art. 6(1)(f));
and compliance with a legal obligation, such as responding to a Shopify compliance webhook (Art.
6(1)(c)). Where Law 25 or PIPEDA applies, processing is carried out because it is necessary to
provide the service the Merchant has requested, subject to the Merchant's own consent
obligations toward its own customers.

## 5. Subprocessors and infrastructure providers

We do not sell merchant or customer data. Data is shared only with the infrastructure providers
required to operate the App, currently:

| Provider | Role | Location |
| --- | --- | --- |
| Shopify Inc. | Platform, Admin API, App Pricing billing | Global (Shopify-operated) |
| Render Services, Inc. | Application hosting | Oregon, United States |
| Supabase, Inc. (PostgreSQL) | Database storage | United States |

We may add or change subprocessors from time to time as operationally necessary; material
changes will be reflected in an updated version of this policy.

## 6. International data transfers

ShopOps Studio is operated from Québec, Canada, but the infrastructure providers listed in
Section 5 process and store data in the United States. If you or your customers are located in
Québec, Canada, the European Economic Area, the United Kingdom, or another jurisdiction with
its own cross-border transfer rules, this means personal information may be transferred to and
processed in a jurisdiction whose privacy laws differ from your own. We take reasonable
contractual, technical, and organizational measures with our subprocessors to protect
information transferred in this way, consistent with Law 25's requirements for a privacy impact
assessment before information is transferred outside Québec.

## 7. Data retention and deletion

- Shop-scoped business analytics data may be retained for up to **30 days** after the App is
  uninstalled, to support accidental-uninstall recovery and short-term support. Shopify's
  `shop/redact` webhook (or another valid deletion request) always takes precedence and results
  in immediate deletion, even within that window.
- Minimal compliance audit events (topic, status, timestamp, and non-sensitive details — never
  raw customer contact values) are retained for **one year** for security and compliance
  evidence.
- Uninstalling the App immediately deletes Shopify sessions and the App's billing cache. A
  reinstall always requires fresh Shopify authentication and a fresh billing check; no cached
  paid state carries over.

## 8. Shopify's mandatory privacy webhooks

ShopOps Studio implements Shopify's three mandatory compliance webhooks:

- **`customers/data_request`** — we record a compliance audit event. Because ShopOps Studio does
  not store direct customer profile fields, most of the data a customer would request is order
  history the Merchant already controls in Shopify; where reporting records genuinely contain
  data responsive to the request, we make it available to the Merchant to fulfill within
  Shopify's required timeframe. We do not log or retain raw customer email or phone values from
  the webhook payload itself.
- **`customers/redact`** — where Shopify provides order IDs, we redact the display fields of the
  matching orders in our reporting tables while preserving the aggregate financial totals needed
  for the Merchant's own analytics.
- **`shop/redact`** — we delete all shop-scoped business-analytics data and Shopify sessions for
  the requesting shop, and record a minimal compliance audit event as described in Section 7.

All three webhook routes verify Shopify's HMAC signature; requests that fail verification receive
an HTTP 401 response and are not processed.

## 9. Your rights

Depending on where you or your customers are located, you may have rights to access, correct,
delete, or receive a copy of personal information, to object to or restrict certain processing,
and (in California) to know what personal information is collected and to non-discrimination for
exercising these rights. Because ShopOps Studio acts as a processor/service provider for the
Merchant's store data, requests from a Merchant's customers should generally be directed to the
Merchant first; the Merchant may in turn contact us at
[support@shopopsstudio.com](mailto:support@shopopsstudio.com) for anything that requires our
assistance. Merchants may exercise the same rights over their own account and configuration data
directly by contacting us.

## 10. Security

We use Shopify OAuth sessions, Shopify webhook signature verification, and bearer-secret
protection for internal cron/maintenance endpoints. Access to production infrastructure is
limited to what is operationally necessary. No method of transmission or storage is completely
secure; we cannot guarantee absolute security, but we take reasonable, industry-standard measures
to protect the data described in this policy.

## 11. Children's privacy

The App is a business tool for Shopify merchants and is not directed at, or knowingly used to
collect information from, children. We do not knowingly collect personal information from
individuals under the age of majority in their jurisdiction in connection with the App.

## 12. Changes to this policy

We may update this policy from time to time to reflect changes in the App, our infrastructure, or
applicable law. We will update the "Last updated" date above, and where a change is material we
will make reasonable efforts to notify Merchants (for example, by email or an in-app notice)
before it takes effect.

## 13. Contact us

Questions, requests, or complaints about this policy or about how ShopOps Studio handles data can
be sent to [support@shopopsstudio.com](mailto:support@shopopsstudio.com). We aim to respond within
2 business days; security or privacy-sensitive requests are prioritized.
