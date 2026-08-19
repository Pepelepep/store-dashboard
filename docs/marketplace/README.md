# Marketplace Documentation Index

These docs support ShopOps Studio marketplace readiness and reviewer preparation. They are drafts for marketplace planning only and should not be treated as approved legal, production, Shopify, Render, or billing changes.

## Core Readiness

- [Marketplace checklist](MARKETPLACE_CHECKLIST.md)
- [Marketplace environment setup](MARKETPLACE_ENVIRONMENT_SETUP.md)
- [Branch workflow](BRANCH_WORKFLOW.md)
- [Demo store setup](DEMO_STORE_SETUP.md)
- [Reviewer test script](REVIEWER_TEST_SCRIPT.md)
- [Screenshot plan](SCREENSHOT_PLAN.md)

## Legal And Policy

- [Privacy policy](PRIVACY_POLICY.md) — mirrors the live `/privacy` page content
- [Terms of service](TERMS_OF_SERVICE.md) — mirrors the live `/terms` page content
- [Data retention policy](DATA_RETENTION_POLICY.md)
- [Partner Dashboard submission runbook](PARTNER_DASHBOARD_SUBMISSION_RUNBOOK.md)
- [Support and contacts](SUPPORT_AND_CONTACTS.md)

## Data And Shopify Review

- [Shopify scopes justification](SHOPIFY_SCOPES_JUSTIFICATION.md)
- [Protected customer data matrix](PROTECTED_CUSTOMER_DATA_MATRIX.md)
- [POS staff attribution](POS_STAFF_ATTRIBUTION.md)

## Listing Preparation

- [Listing copy draft](LISTING_COPY_DRAFT.md)

## Safety Notes

- `marketplace/stable-prep` is the single active branch. `main` remains a legacy branch and must not receive Marketplace changes without explicit approval.
- Do not change current client production Shopify config, Render production environment variables, or database schema as part of documentation cleanup.
- Do not use client production data in screenshots, demo stores, reviewer flows, or listing assets.
