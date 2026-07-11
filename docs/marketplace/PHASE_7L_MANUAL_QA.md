# Phase 7L manual QA

Use a test shop with ShopOps POS attribution active. Re-sync the relevant orders after changing seller assignments.

- [ ] Seller only: assign a detected seller to a new staff member without an email; confirm no dashboard permission is created.
- [ ] Dashboard user only: create/choose a staff member, enable dashboard access, and confirm POS sales remains unlinked.
- [ ] Manager and seller: link a seller and grant manager access; confirm both areas show on one profile.
- [ ] Multiple Shopify logins: preserve two existing Shopify login identities while changing email, role, or locations.
- [ ] Multiple POS sellers: link two detected sellers to one person; confirm reporting groups both under that person.
- [ ] Attributed seller differs from session operator: confirm the attributed seller receives the sale and the operator appears only in Advanced details/diagnostics.
- [ ] Session fallback: assign the detected session-based seller and confirm the lower-confidence source remains visible in Advanced details.
- [ ] Unmapped seller: confirm reporting says `Unmapped POS seller` and never displays a raw ID.
- [ ] Review later: defer a seller, restore it, then assign it.
- [ ] Historical order: confirm an order before attribution activation remains `Unassigned`.
- [ ] Multiple sellers in one order: confirm separate lines aggregate to their respective staff members.
- [ ] Multiple locations: grant a subset, update it, and confirm authorization follows the saved locations.
- [ ] Access removal: remove dashboard access and confirm the profile, seller links, and historical reporting remain.
- [ ] Authorization isolation: confirm linking a POS seller never creates `user_location_access` rows.
- [ ] Repeated sync: sync the same orders twice and confirm no duplicate people, seller cards, or identities appear.
- [ ] Atomic failure: simulate an access-save database failure and confirm all previous permission rows and profile values remain unchanged.
- [ ] Location replacement: change accessible locations and confirm the old or new complete permission set is always present—never an empty intermediate state.
- [ ] Canonical email change: change the login email and confirm every valid existing Shopify login identity remains authorized at the selected locations.
- [ ] Large history: verify seller-card order count, net sales, and latest activity against a history larger than the API row limit.
- [ ] Metrics idempotency: refresh and repeat order sync; confirm seller metrics and source-qualified identities do not duplicate.

Also verify the Staff & access page keeps raw IDs inside collapsed Advanced details and that the legacy Team Access URL remains usable for bookmarked links.
