import "@shopify/ui-extensions/preact";
import { render } from "preact";

const PROPERTY_KEYS = {
  attributed: "_shopops_attributed_staff_id",
  session: "_shopops_session_staff_id",
};
const STAMP_DEBOUNCE_MS = 150;

let isStamping = false;
let stampQueued = false;
let stampTimer;
let status = {
  staffDetected: false,
  lineCount: 0,
  lastResult: "Waiting for cart",
  lastError: "",
};

function stringify(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function getSessionStaffId() {
  const session = shopify.session.currentSession;
  return stringify(session.staffMemberId) || stringify(session.userId);
}

function getCartLines() {
  return shopify.cart.current.value.lineItems ?? [];
}

function buildLineProperties(line, sessionStaffId) {
  const attributedStaffId = stringify(line.attributedUserId);

  if (attributedStaffId) {
    return { [PROPERTY_KEYS.attributed]: attributedStaffId };
  }

  if (sessionStaffId) {
    return { [PROPERTY_KEYS.session]: sessionStaffId };
  }

  return {};
}

function needsStamp(line, properties) {
  const entries = Object.entries(properties);
  if (entries.length !== 1) return false;
  const [key, value] = entries[0];
  return (line.properties?.[key] ?? "") !== value;
}

function buildStampInputs(lines, sessionStaffId) {
  return lines.flatMap((line) => {
    const properties = buildLineProperties(line, sessionStaffId);
    return line.uuid && needsStamp(line, properties)
      ? [{ lineItemUuid: line.uuid, properties }]
      : [];
  });
}

async function addLineItemProperties(inputs) {
  if (inputs.length === 0) return;

  if (typeof shopify.cart.bulkAddLineItemProperties === "function") {
    try {
      await shopify.cart.bulkAddLineItemProperties(inputs);
      return;
    } catch (error) {
      console.debug(
        "[ShopOps POS attribution] bulk line item properties failed",
        error,
      );
    }
  }

  await Promise.all(
    inputs.map((input) =>
      shopify.cart.addLineItemProperties(input.lineItemUuid, input.properties),
    ),
  );
}

function updateStatus(nextStatus) {
  status = { ...status, ...nextStatus };
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
    const sessionStaffId = getSessionStaffId();
    const inputs = buildStampInputs(lines, sessionStaffId);
    await addLineItemProperties(inputs);
    updateStatus({
      staffDetected: Boolean(sessionStaffId),
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
  stampTimer = setTimeout(() => void stampCart(), STAMP_DEBOUNCE_MS);
}

function getTileSubheading() {
  const staffStatus = status.staffDetected ? "Staff detected" : "Not detected";
  const lineText = `${status.lineCount} cart line${status.lineCount === 1 ? "" : "s"}`;
  const result = status.lastError
    ? `Error: ${status.lastError}`
    : status.lastResult;
  return `${staffStatus} | ${lineText} | ${result}`;
}

function Extension() {
  return (
    <s-tile
      heading={shopify.i18n.translate("tile_heading")}
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
    staffDetected: Boolean(getSessionStaffId()),
    lineCount: getCartLines().length,
  };
  renderTile();
  scheduleStamp();
  return shopify.cart.current.subscribe((cart) => {
    updateStatus({ lineCount: cart.lineItems?.length ?? 0 });
    scheduleStamp();
  });
}

export default async () => {
  register();
};
