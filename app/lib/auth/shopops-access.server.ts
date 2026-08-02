import type { SupabaseClient } from "@supabase/supabase-js";

import { STAFF_ALIAS_TYPES } from "../staff-identity/staff-identity";
import { isValidShopOpsEmail, normalizeShopOpsEmail } from "./shopops-access";

type ShopOpsPerson = {
  id: string;
  display_name: string;
  email: string | null;
  is_active: boolean;
};

async function findPersonByEmail({
  supabase,
  shop,
  email,
}: {
  supabase: SupabaseClient;
  shop: string;
  email: string;
}) {
  const exactPerson = await supabase
    .from("staff_people")
    .select("id, display_name, email, is_active")
    .eq("shop_domain", shop)
    .eq("email", email)
    .maybeSingle();
  if (exactPerson.error) throw new Error(exactPerson.error.message);
  if (exactPerson.data) return exactPerson.data as ShopOpsPerson;

  // The fallback retains compatibility with older mixed-case rows. Filter the
  // result again in application code so LIKE wildcard characters in a valid
  // email can never select a different person.
  const legacyPeople = await supabase
    .from("staff_people")
    .select("id, display_name, email, is_active")
    .eq("shop_domain", shop)
    .ilike("email", email)
    .limit(20);
  if (legacyPeople.error) throw new Error(legacyPeople.error.message);
  const matchingPeople = (legacyPeople.data ?? []).filter(
    (person) => normalizeShopOpsEmail(person.email) === email,
  );
  if (matchingPeople.length > 1) throw new Error("staff_email_ambiguous");
  if (matchingPeople[0]) return matchingPeople[0] as ShopOpsPerson;

  const aliases = await supabase
    .from("staff_identity_aliases")
    .select("person_id, alias_value")
    .eq("shop_domain", shop)
    .eq("alias_type", STAFF_ALIAS_TYPES.email)
    .ilike("alias_value", email)
    .not("person_id", "is", null)
    .limit(20);
  if (aliases.error) throw new Error(aliases.error.message);
  const personIds = [
    ...new Set(
      (aliases.data ?? [])
        .filter((alias) => normalizeShopOpsEmail(alias.alias_value) === email)
        .map((row) => row.person_id)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  if (personIds.length > 1) throw new Error("staff_email_ambiguous");
  if (!personIds[0]) return null;

  const person = await supabase
    .from("staff_people")
    .select("id, display_name, email, is_active")
    .eq("shop_domain", shop)
    .eq("id", personIds[0])
    .maybeSingle();
  if (person.error) throw new Error(person.error.message);
  return (person.data as ShopOpsPerson | null) ?? null;
}

export async function ensureActiveShopOpsPersonByEmail({
  supabase,
  shop,
  email: rawEmail,
  displayName: rawDisplayName,
}: {
  supabase: SupabaseClient;
  shop: string;
  email: string;
  displayName?: string | null;
}) {
  const email = normalizeShopOpsEmail(rawEmail);
  if (!email || !isValidShopOpsEmail(email)) {
    throw new Error("invalid_access_identity");
  }
  const displayName = rawDisplayName?.trim() || email;
  let person = await findPersonByEmail({ supabase, shop, email });

  if (!person) {
    const created = await supabase
      .from("staff_people")
      .insert({
        shop_domain: shop,
        display_name: displayName,
        email,
      })
      .select("id, display_name, email, is_active")
      .single();
    if (created.error?.code === "23505") {
      person = await findPersonByEmail({ supabase, shop, email });
    } else if (created.error) {
      throw new Error(created.error.message);
    } else {
      person = created.data as ShopOpsPerson;
    }
  }

  if (!person) throw new Error("staff_identity_unavailable");

  if (!person.is_active) {
    const restored = await supabase.rpc("restore_archived_staff", {
      p_shop_domain: shop,
      p_person_id: person.id,
    });
    if (restored.error) throw new Error(restored.error.message);
  }

  const updates: Record<string, string | boolean> = {
    email,
    is_active: true,
    updated_at: new Date().toISOString(),
  };
  if (rawDisplayName?.trim()) updates.display_name = displayName;
  const updated = await supabase
    .from("staff_people")
    .update(updates)
    .eq("shop_domain", shop)
    .eq("id", person.id);
  if (updated.error) throw new Error(updated.error.message);

  return {
    personId: person.id,
    email,
    displayName: rawDisplayName?.trim() || person.display_name || email,
    restored: !person.is_active,
  };
}
