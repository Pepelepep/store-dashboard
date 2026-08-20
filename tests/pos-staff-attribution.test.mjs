import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getStaffIdentityAliasCandidates,
  STAFF_ALIAS_TYPES,
} from "../app/lib/staff-identity/staff-identity.ts";

test("a POS session id is never treated as a stable, mappable identity", () => {
  // Genuine explicit attribution keeps its trusted alias type.
  assert.deepEqual(
    getStaffIdentityAliasCandidates({
      shopops_effective_staff_id: "user-1",
      shopops_attribution_source: "attributed_user_id",
    }),
    [{ aliasType: STAFF_ALIAS_TYPES.posAttributedUserId, aliasValue: "user-1" }],
  );
  assert.deepEqual(
    getStaffIdentityAliasCandidates({
      shopops_effective_staff_id: "staff-1",
      shopops_attribution_source: "attributed_staff_member_id",
    }),
    [{ aliasType: STAFF_ALIAS_TYPES.posStaffMemberId, aliasValue: "staff-1" }],
  );

  // Session-derived sources must never land in the same trusted buckets as
  // a real staff PIN (posStaffMemberId) or admin user id (posUserId) — the
  // same register can ring up sales made by different real staff.
  for (const source of [
    "pos_session_staff_member",
    "pos_session_user",
    "pos_session",
  ]) {
    const candidates = getStaffIdentityAliasCandidates({
      shopops_effective_staff_id: "whoever-is-logged-in",
      shopops_attribution_source: source,
    });
    assert.deepEqual(candidates, [
      {
        aliasType: STAFF_ALIAS_TYPES.posEffectiveStaffId,
        aliasValue: "whoever-is-logged-in",
      },
    ]);
    assert.notEqual(candidates[0].aliasType, STAFF_ALIAS_TYPES.posStaffMemberId);
    assert.notEqual(candidates[0].aliasType, STAFF_ALIAS_TYPES.posUserId);
  }

  // No effective id at all -> no candidates, regardless of source.
  assert.deepEqual(
    getStaffIdentityAliasCandidates({
      shopops_effective_staff_id: null,
      shopops_attribution_source: "attributed_user_id",
    }),
    [],
  );
});

test("the removed diagnostic alias helper is not resurrected", () => {
  const source = readFileSync(
    new URL("../app/lib/staff-identity/staff-identity.ts", import.meta.url),
    "utf8",
  );
  // It unconditionally trusted shopops_staff_member_id/shopops_user_id
  // (which carry the POS session id whenever no one explicitly attributed
  // the sale) as if they were stable per-person identities. It had zero
  // callers repo-wide; removed rather than patched.
  assert.doesNotMatch(source, /getDiagnosticStaffIdentityAliasCandidates/);
});

test("session attribution can never feed the resolved seller, on the sync side", () => {
  const sync = readFileSync(
    new URL("../app/lib/sync/shopify-sync.server.ts", import.meta.url),
    "utf8",
  );
  const fn = sync.slice(
    sync.indexOf("function getPosLineItemAttribution"),
    sync.indexOf("function getPosBulkLineItemAttribution"),
  );

  // The old, buggy chain must be gone.
  assert.doesNotMatch(
    fn,
    /compactAttributedStaffId \?\? compactSessionStaffId \?\? legacyEffectiveStaffId/,
  );

  // A legacy _shopops_effective_staff_id row (written by the pre-rewrite
  // extension, which had the identical session-fallback bug under a single
  // combined key) is only trusted when its own recorded source was
  // genuinely explicit.
  assert.match(
    fn,
    /legacyEffectiveIsTrustworthy =\s*\n?\s*source === "attributed_user_id" \|\| source === "attributed_staff_member_id"/,
  );
  assert.match(
    fn,
    /effectiveStaffId =\s*\n?\s*compactAttributedStaffId \?\?\s*\n?\s*\(legacyEffectiveIsTrustworthy \? legacyEffectiveStaffId : null\)/,
  );

  // compactSessionStaffId must not appear anywhere in the effectiveStaffId
  // assignment itself (it may still appear elsewhere, e.g. shopops_staff_member_id).
  const effectiveStaffIdAssignment = fn.slice(
    fn.indexOf("const effectiveStaffId ="),
    fn.indexOf(";", fn.indexOf("const effectiveStaffId =")),
  );
  assert.doesNotMatch(effectiveStaffIdAssignment, /compactSessionStaffId/);

  // Session identity remains visible as an informational marker only.
  assert.match(fn, /"pos_session_staff_member"/);
});

test("historical session-tagged rows cannot resolve via the trusted alias types (query-time, no data rewrite)", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20260820120000_pos_session_attribution_isolation.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.get_reporting_order_lines/,
  );
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.get_reporting_filter_options/,
  );

  // None of the three CASE blocks may route a session source to a trusted
  // alias type anymore.
  assert.doesNotMatch(
    migration,
    /WHEN 'pos_session_staff_member' THEN 'pos_staff_member_id'/,
  );
  assert.doesNotMatch(migration, /WHEN 'pos_session_user' THEN 'pos_user_id'/);
  assert.doesNotMatch(migration, /WHEN 'pos_session' THEN 'pos_user_id'/);

  // Explicit attribution still resolves through its trusted types, and the
  // catch-all remains the quarantine bucket.
  const caseBlocks = [...migration.matchAll(/CASE line\.shopops_attribution_source[\s\S]*?END/g)];
  assert.equal(caseBlocks.length, 3, "expected exactly 3 CASE blocks (2 in get_reporting_order_lines, 1 in get_reporting_filter_options)");
  for (const [block] of caseBlocks) {
    assert.match(block, /WHEN 'attributed_user_id' THEN 'pos_attributed_user_id'/);
    assert.match(block, /WHEN 'attributed_staff_member_id' THEN 'pos_staff_member_id'/);
    assert.match(block, /ELSE 'pos_effective_staff_id'/);
    assert.doesNotMatch(block, /pos_session/);
  }

  // A read-only audit query is delivered, not executed.
  assert.match(migration, /Read-only audit, not executed by this migration/);
});
