# Support and Contacts

Draft status: marketplace preparation draft. Replace placeholders before App Store submission.

## Public Support Contact

Support email: `[support@shopopsstudio.example]`

Support form URL: `[support form URL placeholder]`

Support website: `[support site URL placeholder]`

## Emergency Contact

Emergency technical contact: `[name / role placeholder]`

Emergency email: `[emergency email placeholder]`

Emergency phone or paging channel: `[phone / paging placeholder]`

Use the emergency contact for security incidents, widespread production outages, data deletion failures, compliance webhook failures, or Shopify review escalation.

## Draft Support SLA

Severity 1: production outage, security incident, or data deletion/compliance failure.

- Target first response: 4 business hours.
- Target update cadence: every business day until resolved, or faster during active incident response.

Severity 2: core dashboard unavailable, sync blocked, or materially incorrect reporting for multiple users.

- Target first response: 1 business day.
- Target update cadence: every 2 business days.

Severity 3: single-shop reporting issue, permissions question, listing question, or minor UX issue.

- Target first response: 2 business days.
- Target update cadence: as needed.

Severity 4: feature request, general question, or non-urgent documentation issue.

- Target first response: 5 business days.

These are draft targets, not contractual guarantees unless published as final commitments.

## What Merchants Should Include

Ask merchants to include:

- Shopify shop domain.
- Contact name and role.
- Page or workflow affected.
- Date/time and timezone when the issue occurred.
- Screenshots or screen recording if possible.
- Whether the issue affects all staff or one staff user.
- Whether recent Shopify changes occurred, such as new locations, products, refunds, returns, staff, or permissions.
- For reporting issues, the expected value, observed value, and sample order/product/location IDs.

Merchants should not send customer addresses, phone numbers, full payment details, or unnecessary customer personal data in support requests.

## Operational Escalation Notes

Escalate internally when:

- Shopify compliance webhooks fail or cannot be confirmed.
- `shop/redact` deletion cannot complete.
- Internal cron endpoints are unauthorized due to missing/rotated `CRON_SECRET`.
- A sync job repeatedly fails for the same shop.
- A merchant reports cross-shop data exposure.
- Protected customer data handling is questioned by Shopify review.
- Production Render, Supabase, Shopify API, or database availability blocks app usage.

## Pre-Submission Contact Checklist

- Confirm support email inbox exists and is monitored.
- Confirm emergency contact details are valid.
- Confirm Shopify Partner/App Store contact metadata matches this document.
- Confirm privacy policy and terms URLs are live.
- Confirm support workflow does not request unnecessary customer personal data.
