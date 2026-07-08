import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { useEffect, useMemo, useState } from "react";

import { authenticate } from "../shopify.server";
import { getSupabaseAdminClient } from "../lib/db/supabase.server";
import { assertAdminAccess } from "../lib/auth/permissions.server";
import { AppButtonLink } from "../components/ui/AppButton";
import { RouteErrorNotice } from "../components/ui/RouteErrorNotice";
import {
  ensureShopInitialized,
  logEmptyDataState,
} from "../lib/shop/shop-initialization.server";

type LocationRow = {
  shopify_location_id: string;
  name: string;
  is_active: boolean;
};

type LocationNameRow = Pick<LocationRow, "shopify_location_id" | "name">;

type PermissionRow = {
  id: string;
  shop_domain: string;
  access_label: string | null;
  user_email: string | null;
  shopify_user_id: string | null;
  shopify_location_id: string | null;
  location_name: string | null;
  role: string | null;
  can_view: boolean | null;
  can_manage: boolean | null;
  created_at: string | null;
};

type StaffMemberRow = {
  shopify_staff_id: string;
  email: string | null;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  is_active: boolean | null;
};

type LoaderData = {
  shop: string;
  currentUser: {
    email: string | null;
    shopifyUserId: string | null;
    displayName: string;
  };
  currentAccess: {
    role: string | null;
    isAdmin: boolean;
    source: string;
  };
  locations: LocationRow[];
  permissions: PermissionRow[];
  staffMembers: StaffMemberRow[];
};

type ActionData = {
  ok: boolean;
  message: string;
  fieldErrors?: {
    access_label?: string;
    staff?: string;
    user_email?: string;
    shopify_user_id?: string;
    role?: string;
    locations?: string;
  };
};

type AccessFormState = {
  access_label: string;
  user_email: string;
  shopify_user_id: string;
  linkedShopifyUserIds: string[];
  role: string;
  locationIds: string[];
  selectedStaffId: string;
};

type PermissionGroup = {
  key: string;
  access_label: string;
  user_email: string;
  shopifyUserIds: string[];
  role: string;
  locationIds: string[];
  locationNames: string[];
  can_manage: boolean;
};

type ButtonVariant = "primary" | "secondary" | "danger";

const emptyAccessForm: AccessFormState = {
  access_label: "",
  user_email: "",
  shopify_user_id: "",
  linkedShopifyUserIds: [],
  role: "viewer",
  locationIds: [],
  selectedStaffId: "",
};

const buttonBaseStyle = {
  borderRadius: 10,
  padding: "10px 14px",
  fontWeight: 700,
  transition:
    "background-color 120ms ease, border-color 120ms ease, color 120ms ease, transform 80ms ease",
};

const buttonVariants: Record<
  ButtonVariant,
  {
    border: string;
    background: string;
    color: string;
    hoverBackground: string;
    hoverBorder: string;
    activeBackground: string;
    disabledBackground: string;
    disabledBorder: string;
    disabledColor: string;
  }
> = {
  primary: {
    border: "#202223",
    background: "#202223",
    color: "white",
    hoverBackground: "#303336",
    hoverBorder: "#303336",
    activeBackground: "#111213",
    disabledBackground: "#8a8f93",
    disabledBorder: "#8a8f93",
    disabledColor: "white",
  },
  secondary: {
    border: "#c9cccf",
    background: "white",
    color: "#202223",
    hoverBackground: "#f6f6f7",
    hoverBorder: "#8a8f93",
    activeBackground: "#eceff1",
    disabledBackground: "white",
    disabledBorder: "#dde0e4",
    disabledColor: "#8a8f93",
  },
  danger: {
    border: "#c9cccf",
    background: "white",
    color: "#b42318",
    hoverBackground: "#fff4f4",
    hoverBorder: "#d92d20",
    activeBackground: "#fee4e2",
    disabledBackground: "white",
    disabledBorder: "#dde0e4",
    disabledColor: "#8a8f93",
  },
};

function normalizeEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() ?? "";
}

function normalizeEmailOrNull(email: string | null | undefined) {
  return normalizeEmail(email) || null;
}

function normalizeText(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function normalizeTextOrNull(value: string | null | undefined) {
  return normalizeText(value) || null;
}

function getButtonStyle({
  variant,
  disabled,
  isHovered,
  isActive,
  compact = false,
  fullWidth = false,
}: {
  variant: ButtonVariant;
  disabled: boolean;
  isHovered: boolean;
  isActive: boolean;
  compact?: boolean;
  fullWidth?: boolean;
}) {
  const colors = buttonVariants[variant];
  const background = disabled
    ? colors.disabledBackground
    : isActive
      ? colors.activeBackground
      : isHovered
        ? colors.hoverBackground
        : colors.background;
  const borderColor = disabled
    ? colors.disabledBorder
    : isHovered || isActive
      ? colors.hoverBorder
      : colors.border;

  return {
    ...buttonBaseStyle,
    width: fullWidth ? "100%" : undefined,
    border: `1px solid ${borderColor}`,
    background,
    color: disabled ? colors.disabledColor : colors.color,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.72 : 1,
    padding: compact ? "6px 10px" : buttonBaseStyle.padding,
    borderRadius: compact ? 8 : buttonBaseStyle.borderRadius,
    transform: isActive && !disabled ? "translateY(1px)" : "translateY(0)",
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();
  await ensureShopInitialized({
    route: "app.admin.permissions",
    shop: session.shop,
    supabase,
  });
  const permissionContext = await assertAdminAccess({ request, session, supabase });

  const [
    { data: locationsData, error: locationsError },
    { data: permissionsData, error: permissionsError },
    { data: staffMembersData, error: staffMembersError },
  ] =
    await Promise.all([
      supabase
        .from("locations")
        .select("shopify_location_id, name, is_active")
        .eq("shop_domain", session.shop)
        .eq("is_active", true)
        .order("name", { ascending: true }),
      supabase
        .from("user_location_access")
        .select(
          "id, shop_domain, access_label, user_email, shopify_user_id, shopify_location_id, location_name, role, can_view, can_manage, created_at",
        )
        .eq("shop_domain", session.shop)
        .order("user_email", { ascending: true }),
      supabase
        .from("staff_members")
        .select("shopify_staff_id, email, name, first_name, last_name, is_active")
        .eq("shop_domain", session.shop)
        .order("name", { ascending: true }),
    ]);

  if (locationsError) throw new Response(locationsError.message, { status: 500 });
  if (permissionsError) throw new Response(permissionsError.message, { status: 500 });
  if (staffMembersError) throw new Response(staffMembersError.message, { status: 500 });

  const locations = (locationsData ?? []) as LocationRow[];
  const permissions = (permissionsData ?? []) as PermissionRow[];
  const staffMembers = (staffMembersData ?? []) as StaffMemberRow[];
  if (locations.length === 0 && permissions.length === 0 && staffMembers.length === 0) {
    logEmptyDataState({
      route: "app.admin.permissions",
      shop: session.shop,
      reason: "no_locations_permissions_or_staff",
      counts: {
        locations: locations.length,
        permissions: permissions.length,
        staffMembers: staffMembers.length,
      },
    });
  }

  return {
    shop: session.shop,
    currentUser: permissionContext.identity,
    currentAccess: {
      role: permissionContext.role,
      isAdmin: permissionContext.isAdmin,
      source: permissionContext.accessSource,
    },
    locations,
    permissions,
    staffMembers,
  } satisfies LoaderData;
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const supabase = getSupabaseAdminClient();
  await ensureShopInitialized({
    route: "app.admin.permissions.action",
    shop: session.shop,
    supabase,
  });
  await assertAdminAccess({ request, session, supabase });

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "save");

  if (intent === "delete") {
    const email = normalizeEmailOrNull(String(formData.get("user_email") ?? ""));
    const shopifyUserIds = formData
      .getAll("shopify_user_ids")
      .map((value) => normalizeText(String(value)))
      .filter(Boolean);
    const shopifyUserId =
      String(formData.get("shopify_user_id") ?? "").trim() || null;
    const userIdsToDelete = Array.from(
      new Set([...shopifyUserIds, ...(shopifyUserId ? [shopifyUserId] : [])]),
    );

    if (!email && userIdsToDelete.length === 0) {
      return {
        ok: false,
        message: "Missing identity.",
        fieldErrors: {
          user_email: "Email or Shopify user ID is required to delete access.",
        },
      } satisfies ActionData;
    }

    const deleteResults = await Promise.all([
      email
        ? supabase
            .from("user_location_access")
            .delete()
            .eq("shop_domain", session.shop)
            .eq("user_email", email)
        : Promise.resolve({ error: null }),
      ...userIdsToDelete.map((userId) =>
        supabase
          .from("user_location_access")
          .delete()
          .eq("shop_domain", session.shop)
          .eq("shopify_user_id", userId),
      ),
    ]);
    const error = deleteResults.find((result) => result.error)?.error;
    if (error) {
      return {
        ok: false,
        message: error.message,
      } satisfies ActionData;
    }

    return {
      ok: true,
      message: "Access deleted.",
    } satisfies ActionData;
  }

  const accessLabel = normalizeTextOrNull(
    String(formData.get("access_label") ?? ""),
  );
  const email = normalizeEmailOrNull(String(formData.get("user_email") ?? ""));
  const shopifyUserId = String(formData.get("shopify_user_id") ?? "").trim() || null;
  const role = String(formData.get("role") ?? "viewer");
  const locationIds = formData.getAll("locationIds").map(String).filter(Boolean);

  if (!email && !shopifyUserId) {
    return {
      ok: false,
      message: "Email or Shopify user ID is required.",
      fieldErrors: {
        user_email: "Enter the staff member's Shopify account email or Shopify user ID.",
      },
    } satisfies ActionData;
  }

  if (!email && !accessLabel) {
    return {
      ok: false,
      message: "Access label is required when email is empty.",
      fieldErrors: {
        access_label: "Add a label so you can recognize this access.",
      },
    } satisfies ActionData;
  }

  if (!role) {
    return {
      ok: false,
      message: "Role is required.",
      fieldErrors: {
        role: "Select a role.",
      },
    } satisfies ActionData;
  }

  if (!locationIds.length && role !== "admin") {
    return {
      ok: false,
      message: "Select at least one location.",
      fieldErrors: {
        locations: "Select at least one location for this role.",
      },
    } satisfies ActionData;
  }

  const { data: locationsData, error: locationsError } = await supabase
    .from("locations")
    .select("shopify_location_id, name")
    .eq("shop_domain", session.shop);

  if (locationsError) {
    return {
      ok: false,
      message: locationsError.message,
    } satisfies ActionData;
  }

  const locationsById = new Map(
    ((locationsData ?? []) as LocationNameRow[]).map((location) => [
      location.shopify_location_id,
      location.name,
    ]),
  );

  const existingShopifyUserIdsFromForm = formData
    .getAll("linked_shopify_user_ids")
    .map((value) => normalizeText(String(value)))
    .filter(Boolean);
  const { data: existingRowsData, error: existingRowsError } = email
    ? await supabase
        .from("user_location_access")
        .select("shopify_user_id")
        .eq("shop_domain", session.shop)
        .eq("user_email", email)
    : { data: [], error: null };

  if (existingRowsError) {
    return {
      ok: false,
      message: existingRowsError.message,
    } satisfies ActionData;
  }

  const linkedShopifyUserIds = Array.from(
    new Set(
      [
        ...existingShopifyUserIdsFromForm,
        ...((existingRowsData ?? []) as Array<{ shopify_user_id: string | null }>)
          .map((row) => normalizeText(row.shopify_user_id))
          .filter(Boolean),
        ...(shopifyUserId ? [shopifyUserId] : []),
      ].filter(Boolean),
    ),
  );
  const aliasesForRows = email
    ? linkedShopifyUserIds.length > 0
      ? linkedShopifyUserIds
      : [null]
    : linkedShopifyUserIds;

  const deleteExistingResults = await Promise.all([
    email
      ? supabase
          .from("user_location_access")
          .delete()
          .eq("shop_domain", session.shop)
          .eq("user_email", email)
      : Promise.resolve({ error: null }),
    ...linkedShopifyUserIds.map((userId) =>
      supabase
        .from("user_location_access")
        .delete()
        .eq("shop_domain", session.shop)
        .eq("shopify_user_id", userId),
    ),
  ]);
  const deleteExistingError = deleteExistingResults.find(
    (result) => result.error,
  )?.error;
  if (deleteExistingError) {
    return {
      ok: false,
      message: deleteExistingError.message,
    } satisfies ActionData;
  }

  const rows = aliasesForRows.flatMap((aliasShopifyUserId) =>
    role === "admin"
      ? [
          {
            access_label: accessLabel,
            shop_domain: session.shop,
            user_email: email,
            shopify_user_id: aliasShopifyUserId,
            shopify_location_id: "*",
            location_name: "All locations",
            role: "admin",
            can_view: true,
            can_manage: true,
          },
        ]
      : locationIds.map((locationId) => ({
          access_label: accessLabel,
          shop_domain: session.shop,
          user_email: email,
          shopify_user_id: aliasShopifyUserId,
          shopify_location_id: locationId,
          location_name: String(locationsById.get(locationId) ?? locationId),
          role,
          can_view: true,
          can_manage: role === "manager",
        })),
  );

  const { error: insertError } = await supabase.from("user_location_access").insert(rows);
  if (insertError) {
    return {
      ok: false,
      message: insertError.message,
    } satisfies ActionData;
  }

  try {
    await upsertStaffIdentityFromAccess({
      supabase,
      shop: session.shop,
      accessLabel,
      email,
      shopifyUserIds: linkedShopifyUserIds,
    });
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    } satisfies ActionData;
  }

  return {
    ok: true,
    message: "Permissions saved.",
  } satisfies ActionData;
}

export function ErrorBoundary() {
  return <RouteErrorNotice />;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ background: "white", border: "1px solid #e3e3e3", borderRadius: 16, padding: 20 }}>
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      {children}
    </section>
  );
}

function FieldHelp({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        color: "#616161",
        fontSize: 13,
        fontWeight: 400,
        lineHeight: 1.35,
        overflowWrap: "anywhere",
      }}
    >
      {children}
    </span>
  );
}

function FieldError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;

  return (
    <span
      style={{
        color: "#b42318",
        fontSize: 13,
        fontWeight: 700,
        lineHeight: 1.35,
        overflowWrap: "anywhere",
      }}
    >
      {children}
    </span>
  );
}

function groupPermissions(permissions: PermissionRow[]) {
  const groups = new Map<string, PermissionGroup>();

  for (const row of permissions) {
    const canonicalEmail = normalizeEmail(row.user_email);
    const accessLabel = normalizeText(row.access_label);
    const key = canonicalEmail
      ? `email:${canonicalEmail}`
      : accessLabel
        ? `label:${accessLabel.toLowerCase()}`
        : row.shopify_user_id
          ? `shopify:${row.shopify_user_id}`
          : `missing-${row.id}`;
    const existing = groups.get(key);
    const isAdmin = row.role === "admin" || row.shopify_location_id === "*";
    const role = isAdmin ? "admin" : row.role || "viewer";
    const shopifyUserId = normalizeText(row.shopify_user_id);

    if (!existing) {
      groups.set(key, {
        key,
        access_label: accessLabel,
        user_email: canonicalEmail,
        shopifyUserIds: shopifyUserId ? [shopifyUserId] : [],
        role,
        locationIds:
          isAdmin || !row.shopify_location_id ? [] : [row.shopify_location_id],
        locationNames: [
          isAdmin
            ? "All locations"
            : row.location_name ?? row.shopify_location_id ?? "-",
        ],
        can_manage: Boolean(row.can_manage),
      });
      continue;
    }

    if (!existing.access_label && accessLabel) {
      existing.access_label = accessLabel;
    }

    if (!existing.user_email && canonicalEmail) {
      existing.user_email = canonicalEmail;
    }

    if (shopifyUserId && !existing.shopifyUserIds.includes(shopifyUserId)) {
      existing.shopifyUserIds.push(shopifyUserId);
    }

    if (isAdmin) {
      existing.role = "admin";
      existing.locationIds = [];
      existing.locationNames = ["All locations"];
      existing.can_manage = true;
      continue;
    }

    if (row.role === "manager") {
      existing.role = "manager";
    }

    if (row.can_manage) {
      existing.can_manage = true;
    }

    if (row.shopify_location_id && !existing.locationIds.includes(row.shopify_location_id)) {
      existing.locationIds.push(row.shopify_location_id);
      existing.locationNames.push(row.location_name ?? row.shopify_location_id);
    }
  }

  return Array.from(groups.values()).sort((a, b) =>
    (a.user_email || a.access_label || a.shopifyUserIds[0] || "").localeCompare(
      b.user_email || b.access_label || b.shopifyUserIds[0] || "",
    ),
  );
}

function getStaffLabel(staffMember: StaffMemberRow) {
  const name = staffMember.name || [staffMember.first_name, staffMember.last_name].filter(Boolean).join(" ");
  const label = name || staffMember.email || staffMember.shopify_staff_id;
  const detail = staffMember.email && staffMember.email !== label
    ? ` · ${staffMember.email}`
    : "";

  return `${label}${detail}`;
}

async function upsertStaffIdentityFromAccess({
  supabase,
  shop,
  accessLabel,
  email,
  shopifyUserIds,
}: {
  supabase: ReturnType<typeof getSupabaseAdminClient>;
  shop: string;
  accessLabel: string | null;
  email: string | null;
  shopifyUserIds: string[];
}) {
  if (!email) {
    return;
  }

  const displayName = accessLabel || email;
  const { data: existingPerson, error: existingPersonError } = await supabase
    .from("staff_people")
    .select("id")
    .eq("shop_domain", shop)
    .eq("email", email)
    .maybeSingle();

  if (existingPersonError) {
    throw new Error(existingPersonError.message);
  }

  const personResult = existingPerson
    ? await supabase
        .from("staff_people")
        .update({ display_name: displayName, updated_at: new Date().toISOString() })
        .eq("shop_domain", shop)
        .eq("id", existingPerson.id)
        .select("id")
        .single()
    : await supabase
        .from("staff_people")
        .insert({
          shop_domain: shop,
          display_name: displayName,
          email,
        })
        .select("id")
        .single();
  const { data: person, error: personError } = personResult;

  if (personError) {
    throw new Error(personError.message);
  }

  const aliasRows = [
    {
      shop_domain: shop,
      person_id: person.id,
      alias_type: "email",
      alias_value: email,
      source: "user_location_access",
      first_seen_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    ...shopifyUserIds.map((shopifyUserId) => ({
      shop_domain: shop,
      person_id: person.id,
      alias_type: "shopify_admin_user_id",
      alias_value: shopifyUserId,
      source: "user_location_access",
      first_seen_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })),
  ];
  const { error: aliasError } = await supabase
    .from("staff_identity_aliases")
    .upsert(aliasRows, { onConflict: "shop_domain,alias_type,alias_value" });

  if (aliasError) {
    throw new Error(aliasError.message);
  }
}

export default function AdminPermissionsPage() {
  const { shop, currentUser, currentAccess, locations, permissions, staffMembers } =
    useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const navigation = useNavigation();
  const permissionGroups = useMemo(
    () => groupPermissions(permissions),
    [permissions],
  );
  const [formState, setFormState] = useState<AccessFormState>(emptyAccessForm);
  const [isActionFeedbackHidden, setIsActionFeedbackHidden] = useState(false);
  const [hoveredButton, setHoveredButton] = useState<string | null>(null);
  const [activeButton, setActiveButton] = useState<string | null>(null);
  const isSubmitting = navigation.state !== "idle";
  const activeIntent = navigation.formData?.get("intent");
  const isSaving = isSubmitting && activeIntent === "save";
  const isDeleting = isSubmitting && activeIntent === "delete";
  const isAdminRole = formState.role === "admin";
  const visibleActionData = isActionFeedbackHidden ? undefined : actionData;
  const fieldErrors = visibleActionData?.ok ? undefined : visibleActionData?.fieldErrors;
  const hasStaffError = Boolean(fieldErrors?.staff || fieldErrors?.user_email);
  const accessLabelFieldBorder = fieldErrors?.access_label ? "1px solid #d92d20" : "1px solid #c9cccf";
  const emailFieldBorder = fieldErrors?.user_email ? "1px solid #d92d20" : "1px solid #c9cccf";
  const staffFieldBorder = hasStaffError ? "1px solid #d92d20" : "1px solid #c9cccf";
  const roleFieldBorder = fieldErrors?.role ? "1px solid #d92d20" : "1px solid #c9cccf";
  const locationsBorder = fieldErrors?.locations ? "1px solid #d92d20" : "1px solid transparent";
  const formShopifyUserIds = Array.from(
    new Set(
      [
        ...formState.linkedShopifyUserIds,
        normalizeText(formState.shopify_user_id),
      ].filter(Boolean),
    ),
  );
  const formPrimaryLabel =
    normalizeText(formState.access_label) ||
    normalizeEmail(formState.user_email) ||
    formShopifyUserIds[0] ||
    "Unlabeled access";
  const formEmailLabel = normalizeEmail(formState.user_email) || "Not provided";
  const formUserIdsLabel =
    formShopifyUserIds.length > 0 ? formShopifyUserIds.join(", ") : "None";

  useEffect(() => {
    setIsActionFeedbackHidden(false);
  }, [actionData]);

  function clearActionFeedback() {
    setIsActionFeedbackHidden(true);
  }

  function getButtonProps({
    id,
    variant,
    disabled = false,
    compact = false,
  }: {
    id: string;
    variant: ButtonVariant;
    disabled?: boolean;
    compact?: boolean;
  }) {
    return {
      style: getButtonStyle({
        variant,
        disabled,
        compact,
        isHovered: hoveredButton === id,
        isActive: activeButton === id,
      }),
      onMouseEnter: () => setHoveredButton(id),
      onMouseLeave: () => {
        setHoveredButton(null);
        setActiveButton(null);
      },
      onMouseDown: () => setActiveButton(id),
      onMouseUp: () => setActiveButton(null),
    };
  }

  function toggleLocation(locationId: string, checked: boolean) {
    clearActionFeedback();
    setFormState((current) => ({
      ...current,
      locationIds: checked
        ? Array.from(new Set([...current.locationIds, locationId]))
        : current.locationIds.filter((id) => id !== locationId),
    }));
  }

  function editGroup(group: PermissionGroup) {
    clearActionFeedback();
    setFormState({
      access_label: group.access_label,
      user_email: group.user_email,
      shopify_user_id: group.shopifyUserIds[0] ?? "",
      linkedShopifyUserIds: group.shopifyUserIds,
      role: group.role,
      locationIds: group.role === "admin" ? [] : group.locationIds,
      selectedStaffId: "",
    });
  }

  function clearForm() {
    clearActionFeedback();
    setFormState(emptyAccessForm);
  }

  function selectStaffMember(staffId: string) {
    clearActionFeedback();

    if (!staffId) {
      setFormState((current) => ({
        ...current,
        selectedStaffId: "",
        shopify_user_id: "",
        linkedShopifyUserIds: [],
        user_email: "",
      }));
      return;
    }

    const staffMember = staffMembers.find(
      (member) => member.shopify_staff_id === staffId,
    );
    const staffEmail = normalizeEmail(staffMember?.email);
    const existingAccess =
      permissionGroups.find((group) => group.user_email === staffEmail) ??
      permissionGroups.find((group) => group.shopifyUserIds.includes(staffId));

    setFormState((current) => ({
      ...current,
      selectedStaffId: staffId,
      access_label: existingAccess?.access_label ?? current.access_label,
      shopify_user_id: staffMember?.shopify_staff_id ?? current.shopify_user_id,
      linkedShopifyUserIds: existingAccess?.shopifyUserIds ?? current.linkedShopifyUserIds,
      user_email: existingAccess?.user_email || staffEmail || current.user_email,
      role: existingAccess?.role ?? emptyAccessForm.role,
      locationIds:
        existingAccess?.role === "admin"
          ? []
          : existingAccess?.locationIds ?? emptyAccessForm.locationIds,
    }));
  }

  return (
    <main style={{ minHeight: "100vh", background: "#f6f6f7", padding: 28, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <header style={{ marginBottom: 28 }}>
          <h1 style={{ margin: 0, fontSize: 32 }}>Team Access</h1>
          <p style={{ color: "#616161", margin: "8px 0 0" }}>
            Add users manually by email or Shopify user ID.
          </p>
        </header>

        <div style={{ display: "grid", gap: 20 }}>
          <Card title="Current detected identity">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, fontSize: 14 }}>
              <div>
                <div style={{ color: "#616161", fontWeight: 800 }}>Shopify user ID</div>
                <div style={{ fontWeight: 700 }}>{currentUser.shopifyUserId ?? "Unavailable"}</div>
              </div>
              <div>
                <div style={{ color: "#616161", fontWeight: 800 }}>Email</div>
                <div style={{ fontWeight: 700 }}>{currentUser.email ?? "Unavailable"}</div>
              </div>
              <div>
                <div style={{ color: "#616161", fontWeight: 800 }}>Role</div>
                <div style={{ fontWeight: 700 }}>{currentAccess.role ?? "No assigned role"}</div>
              </div>
              <div>
                <div style={{ color: "#616161", fontWeight: 800 }}>Access source</div>
                <div style={{ fontWeight: 700 }}>
                  {currentAccess.isAdmin ? "Admin" : "Non-admin"} · {currentAccess.source}
                </div>
              </div>
            </div>
          </Card>

          <Card title="Grant access">
            <Form method="post" style={{ display: "grid", gap: 18 }}>
              <input type="hidden" name="intent" value="save" />
              {formState.linkedShopifyUserIds.map((userId) => (
                <input
                  key={userId}
                  type="hidden"
                  name="linked_shopify_user_ids"
                  value={userId}
                />
              ))}

              <div style={{ display: "grid", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#616161", textTransform: "uppercase" }}>
                    Step 1
                  </div>
                  <div style={{ fontWeight: 800, fontSize: 18 }}>Team member identity</div>
                  <FieldHelp>
                    Use email as the main identity. Add Shopify user IDs only when a team member uses different Shopify/POS identities. If email is unavailable, add a label so you can recognize the access later.
                  </FieldHelp>
                </div>

                <label style={{ display: "grid", gap: 6, fontWeight: 700, minWidth: 0 }}>
                  Access label
                  <input
                    name="access_label"
                    placeholder="Maya - POS Laval"
                    value={formState.access_label}
                    onChange={(event) => {
                      clearActionFeedback();
                      setFormState((current) => ({
                        ...current,
                        access_label: event.target.value,
                      }));
                    }}
                    style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 8, border: accessLabelFieldBorder }}
                  />
                  <FieldError>{fieldErrors?.access_label}</FieldError>
                </label>

                <label style={{ display: "grid", gap: 6, fontWeight: 700, minWidth: 0 }}>
                  Shopify account email
                  <input
                    name="user_email"
                    placeholder="manager@example.com"
                    value={formState.user_email}
                    onChange={(event) => {
                      clearActionFeedback();
                      setFormState((current) => ({
                        ...current,
                        selectedStaffId: "",
                        user_email: event.target.value,
                      }));
                    }}
                    style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 8, border: emailFieldBorder }}
                  />
                  <FieldError>{fieldErrors?.user_email}</FieldError>
                </label>

                <label style={{ display: "grid", gap: 6, fontWeight: 700, minWidth: 0 }}>
                  Shopify user ID optional
                  <input
                    name="shopify_user_id"
                    placeholder="Optional"
                    value={formState.shopify_user_id}
                    onChange={(event) => {
                      clearActionFeedback();
                      setFormState((current) => ({
                        ...current,
                        selectedStaffId: "",
                        shopify_user_id: event.target.value,
                      }));
                    }}
                    style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 8, border: fieldErrors?.shopify_user_id ? "1px solid #d92d20" : "1px solid #c9cccf" }}
                  />
                  <FieldError>{fieldErrors?.shopify_user_id}</FieldError>
                </label>

                <div
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 8,
                    padding: 12,
                    background: "#fafafa",
                  }}
                >
                  <div style={{ fontWeight: 800 }}>{formPrimaryLabel}</div>
                  <div style={{ color: "#616161", fontSize: 13 }}>
                    Email: {formEmailLabel}
                  </div>
                  <div style={{ color: "#616161", fontSize: 13 }}>
                    Shopify user IDs: {formUserIdsLabel}
                  </div>
                </div>

                {staffMembers.length > 0 ? (
                  <label style={{ display: "grid", gap: 6, fontWeight: 700, minWidth: 0 }}>
                    Optional staff suggestion
                    <select
                      value={formState.selectedStaffId}
                      onChange={(event) => selectStaffMember(event.target.value)}
                      style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 8, border: staffFieldBorder }}
                    >
                      <option value="">No suggestion selected</option>
                      {staffMembers.map((staffMember) => (
                        <option
                          key={staffMember.shopify_staff_id}
                          value={staffMember.shopify_staff_id}
                        >
                          {getStaffLabel(staffMember)}
                        </option>
                      ))}
                    </select>
                    <FieldHelp>
                      Optional suggestions only.
                    </FieldHelp>
                    <FieldError>{fieldErrors?.staff}</FieldError>
                  </label>
                ) : null}
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#616161", textTransform: "uppercase" }}>
                    Step 2
                  </div>
                  <div style={{ fontWeight: 800, fontSize: 18 }}>Role</div>
                </div>

                <label style={{ display: "grid", gap: 6, fontWeight: 700, minWidth: 0 }}>
                  Role
                  <select
                    name="role"
                    required
                    value={formState.role}
                    onChange={(event) => {
                      clearActionFeedback();
                      setFormState((current) => ({
                        ...current,
                        role: event.target.value,
                        locationIds:
                          event.target.value === "admin"
                          ? []
                          : current.locationIds,
                      }));
                    }}
                    style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 8, border: roleFieldBorder }}
                  >
                    <option value="viewer">Viewer</option>
                    <option value="manager">Manager</option>
                    <option value="admin">Admin</option>
                  </select>
                  <FieldError>{fieldErrors?.role}</FieldError>
                </label>
              </div>

              <div style={{ border: locationsBorder, borderRadius: 10, padding: fieldErrors?.locations ? 12 : 0, background: fieldErrors?.locations ? "#fff4f4" : "transparent" }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#616161", textTransform: "uppercase" }}>
                  Step 3
                </div>
                <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 4 }}>Locations</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
                  {locations.map((location) => (
                    <label key={location.shopify_location_id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        name="locationIds"
                        value={location.shopify_location_id}
                        checked={formState.locationIds.includes(
                          location.shopify_location_id,
                        )}
                        disabled={isAdminRole}
                        onChange={(event) =>
                          toggleLocation(
                            location.shopify_location_id,
                            event.target.checked,
                          )
                        }
                      />
                      {location.name}
                    </label>
                  ))}
                </div>
                {locations.length === 0 ? (
                  <p style={{ color: "#616161", fontSize: 13, lineHeight: 1.35 }}>
                    Sync locations first to assign location access.
                  </p>
                ) : null}
                {locations.length === 0 ? (
                  <div>
                    <AppButtonLink to="/app/admin/sync" compact>
                      Open Sync Status
                    </AppButtonLink>
                  </div>
                ) : null}
                <FieldError>{fieldErrors?.locations}</FieldError>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <button
                  disabled={isSubmitting}
                  type="submit"
                  {...getButtonProps({
                    id: "save",
                    variant: "primary",
                    disabled: isSubmitting,
                  })}
                >
                  {isSaving ? "Saving..." : "Save permissions"}
                </button>
                <button
                  type="button"
                  onClick={clearForm}
                  disabled={isSubmitting}
                  {...getButtonProps({
                    id: "new-access",
                    variant: "secondary",
                    disabled: isSubmitting,
                  })}
                >
                  New access
                </button>
                {visibleActionData?.ok ? (
                  <span style={{ color: "#067647", fontSize: 14, fontWeight: 700 }}>
                    {visibleActionData.message}
                  </span>
                ) : null}
                {visibleActionData && !visibleActionData.ok ? (
                  <span style={{ color: "#b42318", fontSize: 14, fontWeight: 700 }}>
                    {visibleActionData.fieldErrors
                      ? "Please fix the highlighted fields."
                      : visibleActionData.message}
                  </span>
                ) : null}
              </div>
            </Form>
          </Card>

          <Card title="Current access">
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr>
                    {["User", "Role", "Locations", "Manage", ""].map((header) => (
                      <th key={header} style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #ddd" }}>{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {permissionGroups.map((group) => {
                    const primaryLabel =
                      group.access_label ||
                      group.user_email ||
                      group.shopifyUserIds[0] ||
                      "Unlabeled access";
                    const userIdsLabel =
                      group.shopifyUserIds.length > 0
                        ? group.shopifyUserIds.join(", ")
                        : "None";

                    return (
                      <tr key={group.key}>
                        <td style={{ padding: 10, borderBottom: "1px solid #eee", minWidth: 220 }}>
                          <div style={{ fontWeight: 800 }}>
                            {primaryLabel}
                          </div>
                          <div style={{ color: "#616161", fontSize: 13 }}>
                            Email: {group.user_email || "Not provided"}
                          </div>
                          <div style={{ color: "#616161", fontSize: 13 }}>
                            Shopify user IDs: {userIdsLabel}
                          </div>
                        </td>
                        <td style={{ padding: 10, borderBottom: "1px solid #eee", textTransform: "capitalize" }}>
                          {group.role}
                        </td>
                        <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>
                          {group.locationNames.join(", ") || "-"}
                        </td>
                        <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>
                          {group.can_manage ? "Yes" : "No"}
                        </td>
                        <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button
                              type="button"
                              onClick={() => editGroup(group)}
                              disabled={isSubmitting}
                              {...getButtonProps({
                                id: `edit-${group.key}`,
                                variant: "secondary",
                                disabled: isSubmitting,
                                compact: true,
                              })}
                            >
                              Edit
                            </button>
                            <Form
                              method="post"
                              onSubmit={(event) => {
                                const userLabel =
                                  group.user_email ||
                                  group.access_label ||
                                  "this access";
                                if (!window.confirm(`Delete access for ${userLabel}?`)) {
                                  event.preventDefault();
                                }
                              }}
                            >
                              <input type="hidden" name="intent" value="delete" />
                              <input type="hidden" name="user_email" value={group.user_email} />
                              {group.shopifyUserIds.map((userId) => (
                                <input
                                  key={userId}
                                  type="hidden"
                                  name="shopify_user_ids"
                                  value={userId}
                                />
                              ))}
                              <button
                                disabled={isSubmitting || (!group.user_email && group.shopifyUserIds.length === 0)}
                                type="submit"
                                {...getButtonProps({
                                  id: `delete-${group.key}`,
                                  variant: "danger",
                                  disabled: isSubmitting || (!group.user_email && group.shopifyUserIds.length === 0),
                                  compact: true,
                                })}
                              >
                                {isDeleting ? "Deleting..." : "Delete access"}
                              </button>
                            </Form>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {permissionGroups.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: 14, color: "#616161" }}>
                        No access rules created yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Card>

          <details style={{ color: "#8a8f93", fontSize: 12, lineHeight: 1.5 }}>
            <summary style={{ cursor: "pointer", fontWeight: 800 }}>
              Support diagnostics
            </summary>
            <div style={{ marginTop: 8 }}>
              Shop: {shop}. Current admin: {currentUser.displayName}
              {currentUser.email ? ` (${currentUser.email})` : ""}
              {currentUser.shopifyUserId ? ` · Shopify user ${currentUser.shopifyUserId}` : ""}
            </div>
          </details>
        </div>
      </div>
    </main>
  );
}
