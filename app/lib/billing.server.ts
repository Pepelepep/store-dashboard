type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type BillingEnvironmentSource = Record<string, string | undefined>;

export const EXPECTED_PARTNER_API_VERSION = "2026-07";
export const EXPECTED_SHOPIFY_APP_HANDLE = "shopops-studio";

export const PLAN_DEFINITIONS = {
  solo: {
    displayName: "Solo",
    activeLocations: 1,
    dashboardUsers: 1,
  },
  growth: {
    displayName: "Growth",
    activeLocations: 5,
    dashboardUsers: 5,
  },
  "multi-location": {
    displayName: "Multi-location",
    activeLocations: 10,
    dashboardUsers: null,
  },
  "qa-pilot": {
    displayName: "QA Pilot",
    activeLocations: null,
    dashboardUsers: null,
  },
} as const;

export type PlanHandle = keyof typeof PLAN_DEFINITIONS;
export type PlanDefinition = (typeof PLAN_DEFINITIONS)[PlanHandle];

type DisabledBillingEnvironment = {
  enabled: false;
};

export type EnabledBillingEnvironment = {
  enabled: true;
  organizationId: string;
  accessToken: string;
  appGid: string;
  apiVersion: typeof EXPECTED_PARTNER_API_VERSION;
  appHandle: typeof EXPECTED_SHOPIFY_APP_HANDLE;
};

export type BillingEnvironment =
  | DisabledBillingEnvironment
  | EnabledBillingEnvironment;

type BillingUnavailableReason =
  | "configuration"
  | "shop_identity"
  | "authentication"
  | "throttled"
  | "timeout"
  | "http"
  | "graphql"
  | "malformed_response"
  | "network";

type BillingCycle = {
  startTime: string;
  endTime: string;
};

type ParsedActiveSubscription = {
  shop: {
    id: string;
    myshopifyDomain: string;
  };
  billingPeriod: string;
  cancelAtEndOfCycle: boolean;
  trialEndsAt: string | null;
  currentBillingCycle: BillingCycle | null;
  items: Array<{ handle: string }>;
  pendingUpdate: {
    billingPeriod: string;
    items: Array<{ handle: string }>;
  } | null;
};

export type AccessibleBillingState = {
  state: "active" | "trial" | "canceling";
  billingEnabled: true;
  planHandle: PlanHandle;
  plan: PlanDefinition;
  billingPeriod: string;
  cancelAtEndOfCycle: boolean;
  trialEndsAt: string | null;
  currentBillingCycle: BillingCycle | null;
  pendingPlanHandle: PlanHandle | null;
  pendingPlan: PlanDefinition | null;
};

export type BillingState =
  | {
      state: "disabled";
      billingEnabled: false;
    }
  | AccessibleBillingState
  | {
      state: "missing_subscription" | "unsupported_plan";
      billingEnabled: true;
    }
  | {
      state: "billing_unavailable";
      billingEnabled: true;
      reason: BillingUnavailableReason;
    };

export type BillingAccessResult =
  | {
      access: "allowed";
      billing:
        | Extract<BillingState, { state: "disabled" }>
        | AccessibleBillingState;
    }
  | {
      access: "billing_required";
      billing: Extract<
        BillingState,
        { state: "missing_subscription" | "unsupported_plan" }
      >;
    }
  | {
      access: "billing_unavailable";
      billing: Extract<BillingState, { state: "billing_unavailable" }>;
    };

export type BillingUsage = {
  activeLocations: number;
  dashboardUsers: number;
};

type BillingCacheEntry = {
  expiresAt: number;
  value: BillingState;
};

type ShopGidCacheEntry = {
  expiresAt: number;
  value: string;
};

const BILLING_CACHE_TTL_MS = 30_000;
const SHOP_GID_CACHE_TTL_MS = 10 * 60_000;
const PARTNER_API_TIMEOUT_MS = 5_000;
const MAX_CACHE_ENTRIES = 100;
const billingCache = new Map<string, BillingCacheEntry>();
const shopGidCache = new Map<string, ShopGidCacheEntry>();

const ACTIVE_SUBSCRIPTION_QUERY = `#graphql
  query ShopOpsActiveSubscription($appId: ID!, $shopId: ID!) {
    activeSubscription(appId: $appId, shopId: $shopId) {
      shop {
        id
        myshopifyDomain
      }
      billingPeriod
      cancelAtEndOfCycle
      trialEndsAt
      currentBillingCycle {
        startTime
        endTime
      }
      items {
        handle
      }
      pendingUpdate {
        billingPeriod
        items {
          handle
        }
      }
    }
  }
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeShopDomain(shop: string) {
  return shop.trim().toLowerCase();
}

function logBilling(
  level: "info" | "error",
  event: string,
  context: Record<string, unknown>,
) {
  const logger = level === "error" ? console.error : console.info;
  logger(`[billing] ${event}`, context);
}

function requireEnvironmentValue(
  source: BillingEnvironmentSource,
  name: string,
) {
  const value = source[name]?.trim();
  if (!value) {
    throw new BillingConfigurationError(`Missing ${name}.`);
  }
  return value;
}

export class BillingConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingConfigurationError";
  }
}

export function getBillingEnvironment(
  source: BillingEnvironmentSource = process.env,
): BillingEnvironment {
  const rawEnabled = source.BILLING_ENABLED?.trim().toLowerCase();
  if (!rawEnabled || rawEnabled === "false") {
    return { enabled: false };
  }
  if (rawEnabled !== "true") {
    throw new BillingConfigurationError(
      "BILLING_ENABLED must be true or false.",
    );
  }

  const organizationId = requireEnvironmentValue(
    source,
    "SHOPIFY_PARTNER_ORG_ID",
  );
  const accessToken = requireEnvironmentValue(
    source,
    "SHOPIFY_PARTNER_ACCESS_TOKEN",
  );
  const appGid = requireEnvironmentValue(source, "SHOPIFY_PARTNER_APP_GID");
  const apiVersion = requireEnvironmentValue(
    source,
    "SHOPIFY_PARTNER_API_VERSION",
  );
  const appHandle = requireEnvironmentValue(source, "SHOPIFY_APP_HANDLE");

  if (!/^[A-Za-z0-9_-]+$/.test(organizationId)) {
    throw new BillingConfigurationError(
      "SHOPIFY_PARTNER_ORG_ID has an invalid format.",
    );
  }
  if (!/^gid:\/\/shopify\/App\/[A-Za-z0-9_-]+$/.test(appGid)) {
    throw new BillingConfigurationError(
      "SHOPIFY_PARTNER_APP_GID must be a Shopify App GID.",
    );
  }
  if (apiVersion !== EXPECTED_PARTNER_API_VERSION) {
    throw new BillingConfigurationError(
      `SHOPIFY_PARTNER_API_VERSION must be ${EXPECTED_PARTNER_API_VERSION}.`,
    );
  }
  if (appHandle !== EXPECTED_SHOPIFY_APP_HANDLE) {
    throw new BillingConfigurationError(
      `SHOPIFY_APP_HANDLE must be ${EXPECTED_SHOPIFY_APP_HANDLE}.`,
    );
  }

  return {
    enabled: true,
    organizationId,
    accessToken,
    appGid,
    apiVersion,
    appHandle,
  };
}

export function isBillingEnabled(
  source: BillingEnvironmentSource = process.env,
) {
  return getBillingEnvironment(source).enabled;
}

export function isRecognizedPlanHandle(value: unknown): value is PlanHandle {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(PLAN_DEFINITIONS, value)
  );
}

export function getPlanLimits(planHandle: PlanHandle) {
  return PLAN_DEFINITIONS[planHandle];
}

export function isAccessibleBillingState(
  billing: BillingState,
): billing is AccessibleBillingState {
  return (
    billing.state === "active" ||
    billing.state === "trial" ||
    billing.state === "canceling"
  );
}

export function resolveCurrentPlan(
  items: Array<{ handle: string }>,
): PlanHandle | null {
  if (items.length !== 1) return null;
  return isRecognizedPlanHandle(items[0]?.handle) ? items[0].handle : null;
}

function getCachedValue<T extends { expiresAt: number; value: unknown }>(
  cache: Map<string, T>,
  key: string,
  nowMs: number,
) {
  const cached = cache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= nowMs) {
    cache.delete(key);
    return null;
  }
  return cached.value;
}

function setBoundedCache<T>(cache: Map<string, T>, key: string, value: T) {
  cache.delete(key);
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey === "string") cache.delete(oldestKey);
  }
  cache.set(key, value);
}

export function clearBillingCache(shop?: string) {
  if (shop) {
    billingCache.delete(normalizeShopDomain(shop));
    return;
  }
  billingCache.clear();
}

async function getAuthenticatedShopGid({
  admin,
  shop,
  nowMs,
}: {
  admin: AdminGraphqlClient;
  shop: string;
  nowMs: number;
}) {
  const normalizedShop = normalizeShopDomain(shop);
  const cached = getCachedValue(shopGidCache, normalizedShop, nowMs);
  if (typeof cached === "string") return cached;

  try {
    const response = await admin.graphql(`#graphql
      query ShopIdentityForBilling {
        shop {
          id
        }
      }
    `);
    const payload = (await response.json()) as unknown;
    const data =
      isRecord(payload) && isRecord(payload.data) ? payload.data : null;
    const shopData = data && isRecord(data.shop) ? data.shop : null;
    const shopGid = shopData?.id;
    if (
      !response.ok ||
      !isRecord(payload) ||
      Array.isArray(payload.errors) ||
      typeof shopGid !== "string" ||
      !/^gid:\/\/shopify\/Shop\/[A-Za-z0-9_-]+$/.test(shopGid)
    ) {
      return null;
    }

    setBoundedCache(shopGidCache, normalizedShop, {
      expiresAt: nowMs + SHOP_GID_CACHE_TTL_MS,
      value: shopGid,
    });
    return shopGid;
  } catch {
    return null;
  }
}

function getGraphqlErrorCode(payload: unknown) {
  if (!isRecord(payload) || !Array.isArray(payload.errors)) return null;
  for (const error of payload.errors) {
    if (!isRecord(error) || !isRecord(error.extensions)) continue;
    const code = error.extensions.code;
    if (typeof code === "string" || typeof code === "number") {
      return String(code);
    }
  }
  return null;
}

function parseString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseSubscriptionItems(value: unknown) {
  if (!Array.isArray(value)) return null;
  const items: Array<{ handle: string }> = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.handle !== "string") return null;
    items.push({ handle: item.handle });
  }
  return items;
}

function parseActiveSubscription(
  value: unknown,
  expectedShopGid: string,
  expectedShopDomain: string,
): ParsedActiveSubscription | null {
  if (!isRecord(value) || !isRecord(value.shop)) return null;
  const shopId = parseString(value.shop.id);
  const myshopifyDomain = parseString(value.shop.myshopifyDomain);
  const billingPeriod = parseString(value.billingPeriod);
  const items = parseSubscriptionItems(value.items);
  if (
    !shopId ||
    !myshopifyDomain ||
    shopId !== expectedShopGid ||
    normalizeShopDomain(myshopifyDomain) !==
      normalizeShopDomain(expectedShopDomain) ||
    !billingPeriod ||
    typeof value.cancelAtEndOfCycle !== "boolean" ||
    !items
  ) {
    return null;
  }

  const trialEndsAt =
    value.trialEndsAt === null ? null : parseString(value.trialEndsAt);
  if (value.trialEndsAt !== null && !trialEndsAt) return null;

  let currentBillingCycle: BillingCycle | null = null;
  if (value.currentBillingCycle !== null) {
    if (!isRecord(value.currentBillingCycle)) return null;
    const startTime = parseString(value.currentBillingCycle.startTime);
    const endTime = parseString(value.currentBillingCycle.endTime);
    if (
      !startTime ||
      !endTime ||
      !Number.isFinite(Date.parse(startTime)) ||
      !Number.isFinite(Date.parse(endTime))
    ) {
      return null;
    }
    currentBillingCycle = { startTime, endTime };
  }

  let pendingUpdate: ParsedActiveSubscription["pendingUpdate"] = null;
  if (value.pendingUpdate !== null) {
    if (!isRecord(value.pendingUpdate)) return null;
    const pendingBillingPeriod = parseString(value.pendingUpdate.billingPeriod);
    const pendingItems = parseSubscriptionItems(value.pendingUpdate.items);
    if (!pendingBillingPeriod || !pendingItems) return null;
    pendingUpdate = {
      billingPeriod: pendingBillingPeriod,
      items: pendingItems,
    };
  }

  return {
    shop: { id: shopId, myshopifyDomain },
    billingPeriod,
    cancelAtEndOfCycle: value.cancelAtEndOfCycle,
    trialEndsAt,
    currentBillingCycle,
    items,
    pendingUpdate,
  };
}

export async function getActiveSubscription({
  environment,
  shop,
  shopGid,
  fetchImpl = fetch,
  timeoutMs = PARTNER_API_TIMEOUT_MS,
}: {
  environment: EnabledBillingEnvironment;
  shop: string;
  shopGid: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<
  | { kind: "success"; subscription: ParsedActiveSubscription | null }
  | { kind: "unavailable"; reason: BillingUnavailableReason }
> {
  const normalizedShop = normalizeShopDomain(shop);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const endpoint = `https://partners.shopify.com/${environment.organizationId}/api/${environment.apiVersion}/graphql.json`;
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": environment.accessToken,
      },
      body: JSON.stringify({
        query: ACTIVE_SUBSCRIPTION_QUERY,
        variables: {
          appId: environment.appGid,
          shopId: shopGid,
        },
      }),
      signal: controller.signal,
    });

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      const reason: BillingUnavailableReason =
        response.status === 429
          ? "throttled"
          : response.status === 401 || response.status === 403
            ? "authentication"
            : response.ok
              ? "malformed_response"
              : "http";
      logBilling("error", "subscription lookup failure", {
        shop: normalizedShop,
        billingState: "billing_unavailable",
        reason,
        ...(!response.ok ? { status: response.status } : {}),
      });
      return { kind: "unavailable", reason };
    }

    const graphqlCode = getGraphqlErrorCode(payload)?.toUpperCase() ?? null;
    if (
      response.status === 429 ||
      graphqlCode === "429" ||
      graphqlCode === "THROTTLED" ||
      graphqlCode === "THROTTLING"
    ) {
      logBilling("error", "Partner API throttling", {
        shop: normalizedShop,
        billingState: "billing_unavailable",
      });
      return { kind: "unavailable", reason: "throttled" };
    }
    if (
      response.status === 401 ||
      response.status === 403 ||
      graphqlCode === "401" ||
      graphqlCode === "403" ||
      graphqlCode === "UNAUTHORIZED" ||
      graphqlCode === "FORBIDDEN"
    ) {
      logBilling("error", "subscription lookup failure", {
        shop: normalizedShop,
        billingState: "billing_unavailable",
        reason: "authentication",
      });
      return { kind: "unavailable", reason: "authentication" };
    }
    if (!response.ok) {
      logBilling("error", "subscription lookup failure", {
        shop: normalizedShop,
        billingState: "billing_unavailable",
        reason: "http",
        status: response.status,
      });
      return { kind: "unavailable", reason: "http" };
    }
    if (!isRecord(payload)) {
      logBilling("error", "subscription lookup failure", {
        shop: normalizedShop,
        billingState: "billing_unavailable",
        reason: "malformed_response",
      });
      return { kind: "unavailable", reason: "malformed_response" };
    }
    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      logBilling("error", "subscription lookup failure", {
        shop: normalizedShop,
        billingState: "billing_unavailable",
        reason: "graphql",
      });
      return { kind: "unavailable", reason: "graphql" };
    }
    if (!isRecord(payload.data) || !("activeSubscription" in payload.data)) {
      logBilling("error", "subscription lookup failure", {
        shop: normalizedShop,
        billingState: "billing_unavailable",
        reason: "malformed_response",
      });
      return { kind: "unavailable", reason: "malformed_response" };
    }
    if (payload.data.activeSubscription === null) {
      logBilling("info", "missing subscription", {
        shop: normalizedShop,
        billingState: "missing_subscription",
      });
      return { kind: "success", subscription: null };
    }

    const subscription = parseActiveSubscription(
      payload.data.activeSubscription,
      shopGid,
      normalizedShop,
    );
    if (!subscription) {
      logBilling("error", "subscription lookup failure", {
        shop: normalizedShop,
        billingState: "billing_unavailable",
        reason: "malformed_response",
      });
      return { kind: "unavailable", reason: "malformed_response" };
    }

    return { kind: "success", subscription };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      logBilling("error", "Partner API timeout", {
        shop: normalizedShop,
        billingState: "billing_unavailable",
      });
      return { kind: "unavailable", reason: "timeout" };
    }
    logBilling("error", "subscription lookup failure", {
      shop: normalizedShop,
      billingState: "billing_unavailable",
      reason: "network",
    });
    return { kind: "unavailable", reason: "network" };
  } finally {
    clearTimeout(timeout);
  }
}

function resolveSubscriptionState(
  subscription: ParsedActiveSubscription,
  nowMs: number,
): BillingState {
  const planHandle = resolveCurrentPlan(subscription.items);
  if (!planHandle) {
    logBilling("error", "unsupported plan handle", {
      shop: normalizeShopDomain(subscription.shop.myshopifyDomain),
      billingState: "unsupported_plan",
    });
    return { state: "unsupported_plan", billingEnabled: true };
  }

  const pendingPlanHandle = subscription.pendingUpdate
    ? resolveCurrentPlan(subscription.pendingUpdate.items)
    : null;
  const trialEndsAtMs = subscription.trialEndsAt
    ? Date.parse(subscription.trialEndsAt)
    : null;
  const hasValidTrial =
    trialEndsAtMs !== null &&
    Number.isFinite(trialEndsAtMs) &&
    trialEndsAtMs > nowMs;

  if (
    (subscription.trialEndsAt && !Number.isFinite(trialEndsAtMs)) ||
    (!hasValidTrial && !subscription.currentBillingCycle)
  ) {
    logBilling("error", "subscription lookup failure", {
      shop: normalizeShopDomain(subscription.shop.myshopifyDomain),
      billingState: "billing_unavailable",
      reason: "malformed_response",
    });
    return {
      state: "billing_unavailable",
      billingEnabled: true,
      reason: "malformed_response",
    };
  }

  const state: AccessibleBillingState["state"] = subscription.cancelAtEndOfCycle
    ? "canceling"
    : hasValidTrial
      ? "trial"
      : "active";
  const result: AccessibleBillingState = {
    state,
    billingEnabled: true,
    planHandle,
    plan: PLAN_DEFINITIONS[planHandle],
    billingPeriod: subscription.billingPeriod,
    cancelAtEndOfCycle: subscription.cancelAtEndOfCycle,
    trialEndsAt: subscription.trialEndsAt,
    currentBillingCycle: subscription.currentBillingCycle,
    pendingPlanHandle,
    pendingPlan: pendingPlanHandle ? PLAN_DEFINITIONS[pendingPlanHandle] : null,
  };

  logBilling("info", "subscription lookup success", {
    shop: normalizeShopDomain(subscription.shop.myshopifyDomain),
    billingState: result.state,
    plan: result.planHandle,
  });
  return result;
}

export async function getBillingState({
  admin,
  shop,
  bypassCache = false,
  environment,
  fetchImpl,
  now = () => new Date(),
}: {
  admin: AdminGraphqlClient;
  shop: string;
  bypassCache?: boolean;
  environment?: BillingEnvironment;
  fetchImpl?: FetchLike;
  now?: () => Date;
}): Promise<BillingState> {
  let resolvedEnvironment: BillingEnvironment;
  try {
    resolvedEnvironment = environment ?? getBillingEnvironment();
  } catch {
    logBilling("error", "subscription lookup failure", {
      shop: normalizeShopDomain(shop),
      billingState: "billing_unavailable",
      reason: "configuration",
    });
    return {
      state: "billing_unavailable",
      billingEnabled: true,
      reason: "configuration",
    };
  }

  if (!resolvedEnvironment.enabled) {
    return { state: "disabled", billingEnabled: false };
  }

  const normalizedShop = normalizeShopDomain(shop);
  const nowMs = now().getTime();
  if (!bypassCache) {
    const cached = getCachedValue(billingCache, normalizedShop, nowMs);
    if (cached) return cached as BillingState;
  }

  const shopGid = await getAuthenticatedShopGid({
    admin,
    shop: normalizedShop,
    nowMs,
  });
  if (!shopGid) {
    const unavailable: BillingState = {
      state: "billing_unavailable",
      billingEnabled: true,
      reason: "shop_identity",
    };
    logBilling("error", "subscription lookup failure", {
      shop: normalizedShop,
      billingState: unavailable.state,
      reason: unavailable.reason,
    });
    setBoundedCache(billingCache, normalizedShop, {
      expiresAt: nowMs + BILLING_CACHE_TTL_MS,
      value: unavailable,
    });
    return unavailable;
  }

  const result = await getActiveSubscription({
    environment: resolvedEnvironment,
    shop: normalizedShop,
    shopGid,
    fetchImpl,
  });
  const billingState: BillingState =
    result.kind === "unavailable"
      ? {
          state: "billing_unavailable",
          billingEnabled: true,
          reason: result.reason,
        }
      : result.subscription === null
        ? { state: "missing_subscription", billingEnabled: true }
        : resolveSubscriptionState(result.subscription, nowMs);

  setBoundedCache(billingCache, normalizedShop, {
    expiresAt: nowMs + BILLING_CACHE_TTL_MS,
    value: billingState,
  });
  return billingState;
}

export function refreshBillingState(
  args: Omit<Parameters<typeof getBillingState>[0], "bypassCache">,
) {
  clearBillingCache(args.shop);
  return getBillingState({ ...args, bypassCache: true });
}

export async function requireBillingAccess(
  args: Parameters<typeof getBillingState>[0],
): Promise<BillingAccessResult> {
  const billing = await getBillingState(args);
  if (billing.state === "disabled" || isAccessibleBillingState(billing)) {
    return { access: "allowed", billing };
  }
  if (billing.state === "billing_unavailable") {
    return { access: "billing_unavailable", billing };
  }
  return { access: "billing_required", billing };
}

export function buildHostedPricingUrl({
  shop,
  appHandle = EXPECTED_SHOPIFY_APP_HANDLE,
}: {
  shop: string;
  appHandle?: string;
}) {
  const normalizedShop = normalizeShopDomain(shop);
  const suffix = ".myshopify.com";
  if (!normalizedShop.endsWith(suffix)) {
    throw new Error("A canonical myshopify.com domain is required.");
  }
  const storeHandle = normalizedShop.slice(0, -suffix.length);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(storeHandle)) {
    throw new Error("The Shopify store handle is invalid.");
  }
  if (appHandle !== EXPECTED_SHOPIFY_APP_HANDLE) {
    throw new Error("The Shopify app handle is invalid.");
  }

  return `https://admin.shopify.com/store/${encodeURIComponent(storeHandle)}/charges/${encodeURIComponent(appHandle)}/pricing_plans`;
}

export function verifyBillingCallbackPlan({
  billing,
  returnedPlanHandle,
}: {
  billing: BillingState;
  returnedPlanHandle: PlanHandle;
}) {
  return (
    isAccessibleBillingState(billing) &&
    billing.planHandle === returnedPlanHandle
  );
}

export function logBillingCallbackVerification({
  shop,
  billing,
  matched,
}: {
  shop: string;
  billing: BillingState;
  matched: boolean;
}) {
  logBilling(matched ? "info" : "error", "billing callback verification", {
    shop: normalizeShopDomain(shop),
    billingState: billing.state,
    plan:
      "planHandle" in billing && isRecognizedPlanHandle(billing.planHandle)
        ? billing.planHandle
        : null,
    matched,
  });
}
