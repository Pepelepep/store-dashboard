import "@shopify/ui-extensions/preact";
import {render} from "preact";

const PROPERTY_KEYS = {
  staffMemberId: "_shopops_staff_member_id",
  userId: "_shopops_user_id",
  locationId: "_shopops_location_id",
  deviceId: "_shopops_device_id",
  deviceName: "_shopops_device_name",
  staffLabel: "_shopops_staff_label",
  attributedUserId: "_shopops_attributed_user_id",
  attributedStaffMemberId: "_shopops_attributed_staff_member_id",
  effectiveStaffId: "_shopops_effective_staff_id",
  source: "_shopops_attribution_source",
};
const STAMP_DEBOUNCE_MS = 150;
const STAFF_LABEL_KEYS = [
  "staffMemberName",
  "staffName",
  "staffDisplayName",
  "staffLabel",
  "userName",
  "userDisplayName",
  "userLabel",
  "name",
  "displayName",
];

let isStamping = false;
let stampQueued = false;
let stampTimer;
let deviceIdPromise;
let status = {
  staffDetected: false,
  lineCount: 0,
  lastResult: "Waiting for cart",
  lastError: "",
};

function stringify(value) {
  return value === undefined || value === null ? "" : String(value);
}

function readObjectValue(source, key) {
  return source && typeof source === "object" && key in source
    ? source[key]
    : undefined;
}

function readFirstString(source, keys) {
  for (const key of keys) {
    const value = readObjectValue(source, key);

    if (value !== undefined && value !== null && value !== "") {
      return String(value);
    }
  }

  return "";
}

function getSession() {
  return shopify.session.currentSession;
}

async function getDeviceId() {
  if (shopify.session.deviceId) {
    return stringify(shopify.session.deviceId);
  }

  if (!deviceIdPromise && typeof shopify.device?.getDeviceId === "function") {
    deviceIdPromise = shopify.device.getDeviceId();
  }

  return deviceIdPromise ? stringify(await deviceIdPromise) : "";
}

async function getAttribution() {
  const session = getSession();

  return {
    staffMemberId: stringify(session.staffMemberId),
    userId: stringify(session.userId),
    locationId: stringify(session.locationId),
    deviceId: await getDeviceId(),
    deviceName: stringify(shopify.device?.name ?? shopify.device?.registerName),
    staffLabel: readFirstString(session, STAFF_LABEL_KEYS),
  };
}

function getCartLines() {
  return shopify.cart.current.value.lineItems ?? [];
}

function buildProperties(attribution) {
  const properties = {
    [PROPERTY_KEYS.staffMemberId]: attribution.staffMemberId,
    [PROPERTY_KEYS.userId]: attribution.userId,
    [PROPERTY_KEYS.locationId]: attribution.locationId,
    [PROPERTY_KEYS.deviceId]: attribution.deviceId,
    [PROPERTY_KEYS.deviceName]: attribution.deviceName,
  };

  if (attribution.staffLabel) {
    properties[PROPERTY_KEYS.staffLabel] = attribution.staffLabel;
  }

  return properties;
}

function needsStamp(line, properties) {
  const current = line.properties ?? {};

  return Object.entries(properties).some(
    ([key, value]) => (current[key] ?? "") !== value,
  );
}

function buildLineProperties(line, baseProperties) {
  const lineStaffLabel = readFirstString(line, STAFF_LABEL_KEYS);
  const attributedUserId = stringify(line.attributedUserId);
  const attributedStaffMemberId = stringify(line.attributedStaffMemberId);
  const properties = {...baseProperties};
  const effectiveAttribution =
    getEffectiveAttribution({
      attributedUserId,
      attributedStaffMemberId,
      staffMemberId: baseProperties[PROPERTY_KEYS.staffMemberId],
      userId: baseProperties[PROPERTY_KEYS.userId],
    });

  if (!properties[PROPERTY_KEYS.staffLabel] && lineStaffLabel) {
    properties[PROPERTY_KEYS.staffLabel] = lineStaffLabel;
  }

  properties[PROPERTY_KEYS.attributedUserId] = attributedUserId;
  properties[PROPERTY_KEYS.attributedStaffMemberId] = attributedStaffMemberId;
  properties[PROPERTY_KEYS.effectiveStaffId] = effectiveAttribution.id;
  properties[PROPERTY_KEYS.source] = effectiveAttribution.source;

  return properties;
}

function getEffectiveAttribution({
  attributedUserId,
  attributedStaffMemberId,
  staffMemberId,
  userId,
}) {
  if (attributedUserId) {
    return {id: attributedUserId, source: "attributed_user_id"};
  }

  if (attributedStaffMemberId) {
    return {id: attributedStaffMemberId, source: "attributed_staff_member_id"};
  }

  if (staffMemberId) {
    return {id: staffMemberId, source: "pos_session_staff_member"};
  }

  return {id: userId, source: "pos_session_user"};
}

function buildStampInputs(lines, baseProperties) {
  return lines
    .map((line) => ({line, properties: buildLineProperties(line, baseProperties)}))
    .filter(({line, properties}) => line.uuid && needsStamp(line, properties))
    .map(({line, properties}) => ({
      lineItemUuid: line.uuid,
      properties,
    }));
}

async function addLineItemProperties(inputs) {
  if (inputs.length === 0) return;

  if (typeof shopify.cart.bulkAddLineItemProperties === "function") {
    try {
      await shopify.cart.bulkAddLineItemProperties(inputs);
      return;
    } catch (error) {
      console.debug("[ShopOps POS attribution] bulk line item properties failed", error);
    }
  }

  await Promise.all(
    inputs.map((input) =>
      shopify.cart.addLineItemProperties(input.lineItemUuid, input.properties),
    ),
  );
}

function updateStatus(nextStatus) {
  status = {...status, ...nextStatus};
  renderTile();
}

async function stampCart() {
  if (isStamping) {
    stampQueued = true;
    return;
  }

  isStamping = true;

  try {
    const lines = getCartLines();
    const attribution = await getAttribution();
    const properties = buildProperties(attribution);
    const inputs = buildStampInputs(lines, properties);

    if (inputs.length > 0) {
      await addLineItemProperties(inputs);
    }

    updateStatus({
      staffDetected: Boolean(attribution.staffMemberId),
      lineCount: lines.length,
      lastResult:
        inputs.length > 0
          ? `Auto-stamped ${inputs.length} line${inputs.length === 1 ? "" : "s"}`
          : "Cart already stamped",
      lastError: "",
    });
  } catch (error) {
    console.debug("[ShopOps POS attribution] failed to stamp cart", error);
    updateStatus({
      lineCount: getCartLines().length,
      lastResult: "Auto-stamp failed",
      lastError: error instanceof Error ? error.message : String(error),
    });
  } finally {
    isStamping = false;

    if (stampQueued) {
      stampQueued = false;
      scheduleStamp();
    }
  }
}

function scheduleStamp() {
  clearTimeout(stampTimer);
  stampTimer = setTimeout(() => {
    void stampCart();
  }, STAMP_DEBOUNCE_MS);
}

function getTileSubheading() {
  const staffStatus = status.staffDetected ? "Staff detected" : "Not detected";
  const lineText = `${status.lineCount} cart line${status.lineCount === 1 ? "" : "s"}`;
  const errorText = status.lastError ? `Error: ${status.lastError}` : status.lastResult;

  return `${staffStatus} | ${lineText} | ${errorText}`;
}

function Extension() {
  const {i18n} = shopify;

  return (
    <s-tile
      heading={i18n.translate("tile_heading")}
      subheading={getTileSubheading()}
      onClick={() => shopify.action.presentModal()}
    />
  );
}

function renderTile() {
  render(<Extension />, document.body);
}

function register() {
  status = {
    ...status,
    staffDetected: Boolean(getSession().staffMemberId),
    lineCount: getCartLines().length,
  };

  renderTile();
  scheduleStamp();

  return shopify.cart.current.subscribe((cart) => {
    updateStatus({lineCount: cart.lineItems?.length ?? 0});
    scheduleStamp();
  });
}

export default async () => {
  register();
};
