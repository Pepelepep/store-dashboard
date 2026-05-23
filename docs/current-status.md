# Current Status

This is the main source of truth for Store_dashboard product and technical status.

## Product Shape

Store_dashboard is a React Router + Vite Shopify embedded app for client-facing retail reporting and admin operations.

Current dashboard reporting includes:

- Sales and margin reporting.
- Sales by Vendor.
- Sales by Staff, displayed as a dashboard block next to Sales by Vendor.
- Expenses and fixed expense management.
- Permission-controlled access.

Sales by Staff is a dashboard block, not a separate page.

Technical fields such as `staff_source` and `cost_source` are hidden from the client dashboard.

## Staff Sales Release State

The staff sales work is implemented on staging:

- `read_users` is part of the app config plan and has been added.
- `staff_members` exists.
- Staff attribution columns exist on `orders` and `order_lines`.
- `syncStaffMembers` exists.
- Sync staff members action exists in the Sync Center.
- Permissions staff dropdown works.
- Sales by Staff is visible in the DB dashboard.
- Sales by Staff is displayed next to Sales by Vendor.
- Technical fields are hidden from client-facing dashboard views.

## Sync State

Current sync coverage includes:

- Locations
- Products and variants
- Inventory
- Staff members
- Orders and order lines

Webhooks appear functional and remain part of the normal data refresh path.

Manual Sync Orders UI should return a clear success or error response. A successful order sync should show synced orders, synced order lines, and pages processed when available.

## Known Gaps

- Historical full staff attribution backfill is not implemented yet.
- Sync Center v2 with job progress is future work.

## Workflow

Use this release path:

`feature/*` -> `staging` -> test `SeulementLocalDev` -> `main` -> production

Do not work directly on `main` or production for product changes. Validate on staging before promoting.
