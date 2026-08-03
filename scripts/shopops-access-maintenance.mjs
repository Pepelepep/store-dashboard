import process from "node:process";
import { pathToFileURL } from "node:url";

import { createClient } from "@supabase/supabase-js";

function normalizeEmail(value) {
  return value?.trim().toLowerCase() || null;
}

export function maskEmail(value) {
  const email = normalizeEmail(value);
  if (!email) return null;
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}

export function parseAccessMaintenanceArgs(argv) {
  const result = {
    shop: null,
    email: null,
    apply: false,
    confirmProduction: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--shop") result.shop = argv[++index]?.trim() || null;
    else if (value === "--email") {
      result.email = normalizeEmail(argv[++index]);
    } else if (value === "--apply") result.apply = true;
    else if (value === "--confirm-production") {
      result.confirmProduction = true;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  if (!result.shop) throw new Error("--shop is required");
  if (result.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) {
    throw new Error("--email must be a valid email address");
  }
  return result;
}

function roleScope(role) {
  return role === "owner" || role === "admin" ? "all" : "assigned";
}

export function buildAccessAudit({ shop, email, people, memberships, access }) {
  const normalizedTarget = normalizeEmail(email);
  const membershipsById = new Map(
    memberships.map((membership) => [membership.id, membership]),
  );
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const owners = memberships.filter((membership) => membership.is_owner);
  const targetPeople = normalizedTarget
    ? people.filter(
        (person) => normalizeEmail(person.email) === normalizedTarget,
      )
    : [];
  const targetMemberships = normalizedTarget
    ? memberships.filter(
        (membership) =>
          normalizeEmail(membership.normalized_email) === normalizedTarget ||
          targetPeople.some((person) => person.id === membership.person_id),
      )
    : [];
  const targetMembershipIds = new Set(
    targetMemberships.map((membership) => membership.id),
  );
  const targetPersonIds = new Set(targetPeople.map((person) => person.id));
  const ownerMembershipIds = new Set(owners.map((owner) => owner.id));
  const ownerPersonIds = new Set(
    owners.map((owner) => owner.person_id).filter(Boolean),
  );
  const issueCounts = new Map();
  const canonicalAccess = [];

  for (const row of access) {
    const membership = row.membership_id
      ? membershipsById.get(row.membership_id)
      : null;
    let reason = null;
    if (!row.membership_id) reason = "missing_membership_reference";
    else if (!membership || membership.shop_domain !== shop) {
      reason = "membership_not_in_shop";
    } else if (!membership.person_id) reason = "membership_person_missing";
    else if (row.person_id !== membership.person_id) reason = "person_mismatch";
    else if (
      normalizeEmail(membership.normalized_email) &&
      normalizeEmail(row.user_email) !==
        normalizeEmail(membership.normalized_email)
    ) {
      reason = "email_mismatch";
    } else if (
      row.shopify_user_id?.trim() &&
      row.shopify_user_id.trim() !== membership.shopify_user_id?.trim()
    ) {
      reason = "hidden_identity_mismatch";
    }
    const isInScope =
      !normalizedTarget ||
      normalizeEmail(row.user_email) === normalizedTarget ||
      targetPersonIds.has(row.person_id) ||
      targetMembershipIds.has(row.membership_id) ||
      ownerPersonIds.has(row.person_id) ||
      ownerMembershipIds.has(row.membership_id) ||
      row.shopify_location_id === "*";
    if (reason) {
      if (isInScope) {
        issueCounts.set(reason, (issueCounts.get(reason) ?? 0) + 1);
      }
    } else {
      canonicalAccess.push(row);
    }
  }

  const targetRawAccess = normalizedTarget
    ? access.filter(
        (row) =>
          normalizeEmail(row.user_email) === normalizedTarget ||
          targetPersonIds.has(row.person_id) ||
          targetMembershipIds.has(row.membership_id),
      )
    : [];
  const expectedTargetRole = targetRawAccess.some((row) => row.role === "admin")
    ? "admin"
    : targetRawAccess.some((row) => row.role === "manager")
      ? "manager"
      : "viewer";
  const expectedTargetLocations = targetRawAccess.some(
    (row) => row.shopify_location_id === "*",
  )
    ? ["All reporting locations"]
    : [
        ...new Set(
          targetRawAccess
            .map((row) => row.location_name)
            .filter((value) => Boolean(value)),
        ),
      ].sort();
  const targetLocations = [
    ...new Set(
      canonicalAccess
        .filter((row) => targetMembershipIds.has(row.membership_id))
        .map((row) =>
          row.shopify_location_id === "*"
            ? "All reporting locations"
            : row.location_name || "Unnamed reporting location",
        ),
    ),
  ].sort();
  const owner = owners[0] ?? null;
  const ownerScopeRows = owner
    ? canonicalAccess.filter((row) => row.membership_id === owner.id)
    : [];
  const proposedWrites = [];

  if (
    owners.length !== 1 ||
    owner?.status !== "active" ||
    owner?.role !== "owner" ||
    !owner?.person_id ||
    !ownerScopeRows.some((row) => row.shopify_location_id === "*")
  ) {
    proposedWrites.push(
      "Materialize one active owner person, owner membership, and All-locations scope.",
    );
  }
  if (normalizedTarget) {
    const target = targetMemberships[0] ?? null;
    if (targetPeople.length !== 1 || targetMemberships.length !== 1) {
      proposedWrites.push(
        "Reuse or create one canonical target person and exactly one membership.",
      );
    }
    if (!target || target.status !== "active") {
      proposedWrites.push("Create or re-enable the target membership.");
    }
    if (target && target.role !== expectedTargetRole) {
      proposedWrites.push(
        `Set the target ShopOps role to ${expectedTargetRole}.`,
      );
    }
    if (
      JSON.stringify(targetLocations) !==
      JSON.stringify(expectedTargetLocations)
    ) {
      proposedWrites.push(
        "Replace target scope with the approved legacy location configuration.",
      );
    }
  }
  if (issueCounts.size) {
    proposedWrites.push(
      "Repoint valid location rows to same-shop memberships and remove invalid references atomically.",
    );
  }

  return {
    mode: "read-only audit",
    shop,
    targetEmail: maskEmail(normalizedTarget),
    before: {
      people: {
        count: people.length,
        targetCount: targetPeople.length,
        targetActive: targetPeople.filter((person) => person.is_active).length,
      },
      memberships: {
        count: memberships.length,
        activeCount: memberships.filter(
          (membership) => membership.status === "active",
        ).length,
        ownerCount: owners.length,
        ownerCanonical: Boolean(
          owner &&
          owner.person_id &&
          owner.status === "active" &&
          owner.role === "owner",
        ),
        ownerHasHiddenIdentity: Boolean(owner?.shopify_user_id),
        targetCount: targetMemberships.length,
        target: targetMemberships[0]
          ? {
              role: targetMemberships[0].role,
              status: targetMemberships[0].status,
              hasCanonicalPerson: Boolean(
                targetMemberships[0].person_id &&
                peopleById.has(targetMemberships[0].person_id),
              ),
              hasHiddenIdentity: Boolean(targetMemberships[0].shopify_user_id),
              locationScope: roleScope(targetMemberships[0].role),
            }
          : null,
      },
      locations: {
        target: targetLocations,
        ownerHasAllLocations: ownerScopeRows.some(
          (row) => row.shopify_location_id === "*",
        ),
      },
      integrityIssues: Object.fromEntries([...issueCounts].sort()),
    },
    proposedWrites: [...new Set(proposedWrites)],
    expectedAfter: {
      ownerMemberships: 1,
      ownerPersonLinked: true,
      ownerLocationScope: "All reporting locations",
      targetMemberships: normalizedTarget ? 1 : null,
      targetRole: normalizedTarget ? expectedTargetRole : null,
      targetLocations: normalizedTarget ? expectedTargetLocations : null,
      crossShopOrMissingMembershipReferences: 0,
    },
  };
}

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) are required",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function databaseError(label, error) {
  const code = error?.code ? ` (${error.code})` : "";
  return new Error(`${label} failed${code}; no state was changed`);
}

async function loadAuditRows(client, shop) {
  const [people, memberships, access] = await Promise.all([
    client
      .from("staff_people")
      .select("id, shop_domain, email, is_active")
      .eq("shop_domain", shop),
    client
      .from("dashboard_memberships")
      .select(
        "id, shop_domain, person_id, normalized_email, shopify_user_id, role, status, is_owner",
      )
      .eq("shop_domain", shop),
    client
      .from("user_location_access")
      .select(
        "membership_id, person_id, user_email, role, shopify_location_id, location_name",
      )
      .eq("shop_domain", shop),
  ]);
  if (people.error) throw databaseError("People audit", people.error);
  if (memberships.error) {
    throw databaseError("Membership audit", memberships.error);
  }
  if (access.error) throw databaseError("Location access audit", access.error);
  return {
    people: people.data ?? [],
    memberships: memberships.data ?? [],
    access: access.data ?? [],
  };
}

function isProduction() {
  return [
    process.env.NODE_ENV,
    process.env.APP_ENV,
    process.env.SHOPOPS_ENVIRONMENT,
  ].some((value) => value?.toLowerCase() === "production");
}

export async function runAccessMaintenance({ command, args, client }) {
  const rows = await loadAuditRows(client, args.shop);
  const audit = buildAccessAudit({
    shop: args.shop,
    email: args.email,
    ...rows,
  });
  if (command === "audit" || !args.apply || audit.proposedWrites.length === 0) {
    return {
      ...audit,
      mode:
        command === "audit"
          ? "read-only audit"
          : audit.proposedWrites.length === 0
            ? "dry-run; already canonical"
            : "dry-run; --apply required",
      applied: false,
    };
  }
  if (isProduction() && !args.confirmProduction) {
    throw new Error(
      "Production repair requires --apply and --confirm-production",
    );
  }
  const result = await client.rpc("repair_shopops_access_integrity", {
    p_shop_domain: args.shop,
    p_target_email: args.email,
  });
  if (result.error) throw databaseError("Atomic access repair", result.error);
  const afterRows = await loadAuditRows(client, args.shop);
  const after = buildAccessAudit({
    shop: args.shop,
    email: args.email,
    ...afterRows,
  });
  if (after.proposedWrites.length) {
    throw new Error(
      "Post-repair invariants failed; inspect the database transaction logs",
    );
  }
  return {
    mode: "applied atomically",
    applied: true,
    before: audit.before,
    proposedWrites: audit.proposedWrites,
    expectedAfter: audit.expectedAfter,
    after: after.before,
    databaseResult: result.data,
  };
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  if (!new Set(["audit", "repair"]).has(command)) {
    throw new Error("Expected audit or repair command");
  }
  const args = parseAccessMaintenanceArgs(argv);
  if (command === "audit" && args.apply) {
    throw new Error("The audit command never accepts --apply");
  }
  const report = await runAccessMaintenance({
    command,
    args,
    client: getClient(),
  });
  console.log(JSON.stringify(report, null, 2));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Maintenance failed",
    );
    process.exitCode = 1;
  });
}
