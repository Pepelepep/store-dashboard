/** @jsxImportSource preact */
import { render } from "preact";

const ATTRIBUTION_SOURCE = "pos_session";
const PROPERTY_KEYS = {
  staffMemberId: "_shopops_staff_member_id",
  userId: "_shopops_user_id",
  locationId: "_shopops_location_id",
  deviceId: "_shopops_device_id",
  deviceName: "_shopops_device_name",
  source: "_shopops_attribution_source",
};

let lastCartSignature = "";
let isStamping = false;

function readPath(source, path) {
  return path.split(".").reduce((value, key) => {
    if (value && typeof value === "object" && key in value) {
      return value[key];
    }

    return undefined;
  }, source);
}

function readFirst(source, paths) {
  for (const path of paths) {
    const value = readPath(source, path);

    if (value !== undefined && value !== null && value !== "") {
      return String(value);
    }
  }

  return null;
}

function getSession(api) {
  return (
    readPath(api, "pos.session.current") ??
    readPath(api, "session.current") ??
    readPath(api, "session") ??
    {}
  );
}

function getDevice(api) {
  return (
    readPath(api, "pos.device.current") ??
    readPath(api, "device.current") ??
    readPath(api, "device") ??
    {}
  );
}

function getAttribution(api) {
  const session = getSession(api);
  const device = getDevice(api);

  return {
    staffMemberId: readFirst(session, ["staffMemberId", "staff.memberId", "staffMember.id"]),
    userId: readFirst(session, ["userId", "user.id"]),
    locationId: readFirst(session, ["locationId", "location.id"]),
    posVersion: readFirst(session, ["posVersion", "version"]),
    deviceId: readFirst(device, ["deviceId", "id"]),
    deviceName: readFirst(device, ["deviceName", "name"]),
  };
}

function getCartLines(api) {
  const cart =
    readPath(api, "cart.current") ??
    readPath(api, "cart") ??
    readPath(api, "pos.cart.current") ??
    {};
  const lines =
    readPath(cart, "lineItems") ??
    readPath(cart, "lines") ??
    readPath(cart, "items") ??
    [];

  return Array.isArray(lines) ? lines : [];
}

function getLineId(line) {
  return (
    readFirst(line, ["uuid", "lineItemUuid", "id", "lineItemId", "merchandiseId"]) ??
    null
  );
}

function getLineProperties(line) {
  const properties =
    readPath(line, "properties") ??
    readPath(line, "lineItemProperties") ??
    readPath(line, "customAttributes") ??
    [];

  if (Array.isArray(properties)) {
    return Object.fromEntries(
      properties
        .map((property) => [
          readFirst(property, ["key", "name"]),
          readFirst(property, ["value"]),
        ])
        .filter(([key]) => key),
    );
  }

  return properties && typeof properties === "object" ? properties : {};
}

function buildProperties(attribution) {
  return {
    [PROPERTY_KEYS.staffMemberId]: attribution.staffMemberId ?? "",
    [PROPERTY_KEYS.userId]: attribution.userId ?? "",
    [PROPERTY_KEYS.locationId]: attribution.locationId ?? "",
    [PROPERTY_KEYS.deviceId]: attribution.deviceId ?? "",
    [PROPERTY_KEYS.deviceName]: attribution.deviceName ?? "",
    [PROPERTY_KEYS.source]: ATTRIBUTION_SOURCE,
  };
}

function needsStamp(line, properties) {
  const current = getLineProperties(line);

  return Object.entries(properties).some(
    ([key, value]) => (current[key] ?? "") !== value,
  );
}

function buildStampTargets(lines, properties) {
  return lines
    .map((line) => ({ id: getLineId(line), line }))
    .filter(({ id, line }) => id && needsStamp(line, properties))
    .map(({ id }) => ({
      lineItemUuid: id,
      lineItemId: id,
      id,
      properties,
      lineItemProperties: properties,
    }));
}

function getSignature(lines, attribution, properties) {
  return JSON.stringify({
    attribution,
    lines: lines.map((line) => ({
      id: getLineId(line),
      properties: Object.fromEntries(
        Object.keys(properties).map((key) => [key, getLineProperties(line)[key] ?? ""]),
      ),
    })),
  });
}

async function callBulkAddLineItemProperties(api, targets) {
  const bulkAddLineItemProperties =
    readPath(api, "cart.bulkAddLineItemProperties") ??
    readPath(api, "pos.cart.bulkAddLineItemProperties");

  if (typeof bulkAddLineItemProperties !== "function" || targets.length === 0) {
    return;
  }

  try {
    await bulkAddLineItemProperties(targets);
    return;
  } catch (error) {
    console.debug("[ShopOps POS attribution] bulk array shape failed", error);
  }

  await bulkAddLineItemProperties({
    lineItems: targets,
    properties: targets[0].properties,
  });
}

async function stampCart(api) {
  if (isStamping) return;

  const attribution = getAttribution(api);
  const lines = getCartLines(api);
  const properties = buildProperties(attribution);
  const signature = getSignature(lines, attribution, properties);

  if (lines.length === 0) {
    lastCartSignature = signature;
    return;
  }

  if (signature === lastCartSignature) {
    return;
  }

  const targets = buildStampTargets(lines, properties);

  if (targets.length === 0) {
    lastCartSignature = signature;
    return;
  }

  isStamping = true;

  try {
    await callBulkAddLineItemProperties(api, targets);
    lastCartSignature = signature;
  } catch (error) {
    console.debug("[ShopOps POS attribution] failed to stamp cart", error);
  } finally {
    isStamping = false;
  }
}

function subscribe(api, path, callback) {
  const target = readPath(api, path);

  if (target && typeof target.subscribe === "function") {
    return target.subscribe(callback);
  }

  return undefined;
}

function renderTile() {
  if (typeof document === "undefined" || !document.body) {
    return;
  }

  render(
    <s-tile heading="ShopOps" subheading="Staff tracking active" />,
    document.body,
  );
}

function register(api) {
  renderTile();
  void stampCart(api);

  const unsubscribers = [
    subscribe(api, "cart", () => void stampCart(api)),
    subscribe(api, "pos.cart", () => void stampCart(api)),
    subscribe(api, "session", () => void stampCart(api)),
    subscribe(api, "pos.session", () => void stampCart(api)),
  ].filter((unsubscribe) => typeof unsubscribe === "function");

  return () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  };
}

function getApi(root, api) {
  if (api) return api;
  if (typeof shopify !== "undefined") return shopify;
  return root;
}

export default function shopopsPosAttribution(root, api) {
  return register(getApi(root, api));
}
