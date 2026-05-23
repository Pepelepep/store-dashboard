# Staff Sales Release - May 2026

## Summary

This release adds staff-aware sales reporting and supporting admin sync/permissions workflows on staging.

## Added

- Added Shopify `read_users` scope to app configs.
- Added `staff_members` table.
- Added staff attribution columns on `orders` and `order_lines`.
- Added `syncStaffMembers`.
- Added Sync staff members action in the Sync Center.
- Added staff dropdown in Permissions.
- Added Sales by Staff dashboard block, not a separate page.
- Displayed Sales by Staff next to Sales by Vendor.
- Hid technical fields such as `staff_source` and `cost_source` from the client dashboard.

## Validation Checklist

- Staff sync works.
- Permissions staff dropdown works.
- Sales by Staff is visible in the DB dashboard.
- Sales by Vendor still works.
- `orders/create` webhook still works.
- `orders/updated` webhook still works.
- Manual Sync Orders UI does not return a false `403` after a successful sync.

## Known Gaps

- Historical full staff attribution backfill is not implemented yet.
- Sync Center v2 with job progress is not implemented yet.
