# Phase 7M2 manual QA

Use a test shop with the Phase 7M identity migrations applied. Do not use production identities for test mappings.

- [ ] Import a CSV containing `assisting_staff_id` and `assisting_staff_member_name` in a non-standard column order.
- [ ] Import human-readable `Assisting staff member ID` and `Assisting staff member name` headers.
- [ ] Confirm legacy `assisting_staff_member_id` and `assisting_staff_name` headers still parse without appearing in merchant instructions.
- [ ] Confirm IDs match only an exact, source-qualified attributed POS seller identity.
- [ ] Import one ID with conflicting names and confirm it requires review and cannot be applied.
- [ ] Create seller-only staff without email and confirm no dashboard access is created.
- [ ] Create manager-only staff, enable access by email and locations, and confirm POS sales remains unlinked.
- [ ] Link a detected seller to an existing manager and confirm one profile shows both capabilities.
- [ ] Remove an empty profile and confirm it is permanently deleted.
- [ ] Remove staff with aliases, access, or mapped sales and confirm it is archived instead of deleted.
- [ ] Confirm archived staff is absent from All and present under Archived.
- [ ] Restore archived staff and confirm it returns to All without automatically restoring dashboard access.
- [ ] Confirm removal preserves the historical Sales by Staff label and POS mappings.
- [ ] Change dashboard access and confirm email remains canonical and all Shopify login aliases are preserved.
- [ ] Confirm assigning a POS alias never creates `user_location_access` authorization.
- [ ] Before tile confirmation, confirm the compact notice says Not configured.
- [ ] Confirming the tile changes setup to Waiting for first tracked sale, not Active.
- [ ] Synchronize a new attributed POS sale and confirm setup automatically becomes Active with the earliest verified timestamp.
- [ ] Confirm setup instructs merchants to assign/repeat the Smart Grid template for other POS locations.
- [ ] Confirm historical unstamped orders remain Unassigned and CSV import does not imply historical reconstruction.
