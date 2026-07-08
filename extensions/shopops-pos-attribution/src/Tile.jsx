import "@shopify/ui-extensions/preact";
import {render} from "preact";

const ATTRIBUTION_SOURCE = "pos_session";
const PROPERTY_KEYS = {
  staffMemberId: "_shopops_staff_member_id",
  userId: "_shopops_user_id",
  locationId: "_shopops_location_id",
  deviceId: "_shopops_device_id",
  deviceName: "_shopops_device_name",
  source: "_shopops_attribution_source",
};
const STAMP_DEBOUNCE_MS = 150;

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
  };
}

function getCartLines() {
  return shopify.cart.current.value.lineItems ?? [];
}

function buildProperties(attribution) {
  return {
    [PROPERTY_KEYS.staffMemberId]: attribution.staffMemberId,
    [PROPERTY_KEYS.userId]: attribution.userId,
    [PROPERTY_KEYS.locationId]: attribution.locationId,
    [PROPERTY_KEYS.deviceId]: attribution.deviceId,
    [PROPERTY_KEYS.deviceName]: attribution.deviceName,
    [PROPERTY_KEYS.source]: ATTRIBUTION_SOURCE,
  };
}

function needsStamp(line, properties) {
  const current = line.properties ?? {};

  return Object.entries(properties).some(
    ([key, value]) => (current[key] ?? "") !== value,
  );
}

function buildStampInputs(lines, properties) {
  return lines
    .filter((line) => line.uuid && needsStamp(line, properties))
    .map((line) => ({
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
