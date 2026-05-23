# Sync and Backfill Operations

This document is the source of truth for current sync operations and planned backfill work.

## Current Sync Flow

The app supports manual and automated data sync for the dashboard reporting tables. Current sync operations write sync run details where available so operators can confirm completion and diagnose failures.

Current sync areas include:

- Locations
- Products and variants
- Inventory
- Staff members
- Orders and order lines

Order sync stores order rows and order line rows, including available staff attribution fields when Shopify returns staff data.

Staff sync writes Shopify staff users into `staff_members`. Staff attribution on orders and order lines depends on Shopify order data returned by order sync or webhooks.

## Current Webhooks

Current webhooks appear functional and should remain part of the normal sync path:

- `orders/create`
- `orders/updated`
- product webhooks
- inventory item / inventory level webhooks
- app lifecycle webhooks

Webhook behavior should be validated after sync-related changes.

## Manual Sync Center Actions

Current Sync Center actions include:

- Refresh all data
- Refresh locations
- Refresh products and variants
- Refresh inventory
- Sync staff members
- Refresh orders by date range

Manual actions should return clear success/error responses. The orders sync UI should show synced orders, synced order lines, and pages processed when available.

## Known Limitation

Historical full staff attribution backfill is not implemented yet.

Existing order rows may not have complete staff attribution unless they were synced after the staff attribution work was added or updated through a webhook/manual order sync that returned staff data.

## Future Plan

Sync Center v2 should add job progress, durable status, clearer retry behavior, and better operator feedback for long-running sync/backfill work.

Historical staff attribution backfill should use this strategy:

1. Shopify Bulk Operation first for large historical order datasets.
2. Paginated GraphQL by date batches as a fallback.

Staff sync and backfill jobs must be non-blocking, logged, and safe to retry. Failures should be visible to operators without blocking the rest of the dashboard.
