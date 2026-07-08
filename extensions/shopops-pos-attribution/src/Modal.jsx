import "@shopify/ui-extensions/preact";
import {render} from "preact";
import {useEffect, useState} from "preact/hooks";

const ENABLE_DEV_DIAGNOSTICS = true;
const SESSION_LABEL_KEYS = [
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
const LINE_LABEL_KEYS = [
  ...SESSION_LABEL_KEYS,
  "attributedStaffName",
  "attributedStaffLabel",
  "attributedUserName",
  "attributedUserLabel",
];
const ATTRIBUTION_KEY_PATTERN = /(attribut|staff|user|seller|employee)/i;

export default async () => {
  render(<Extension />, document.body);
};

function readObjectValue(source, key) {
  return source && typeof source === "object" && key in source
    ? source[key]
    : undefined;
}

function stringify(value) {
  return value === undefined || value === null ? "" : String(value);
}

function pickStringFields(source, keys) {
  return Object.fromEntries(
    keys
      .map((key) => [key, stringify(readObjectValue(source, key))])
      .filter(([, value]) => value),
  );
}

function getTopLevelKeys(source) {
  return source && typeof source === "object" ? Object.keys(source).sort() : [];
}

function getMatchingTopLevelFields(source) {
  if (!source || typeof source !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.keys(source)
      .filter((key) => ATTRIBUTION_KEY_PATTERN.test(key))
      .sort()
      .map((key) => [key, stringify(source[key])]),
  );
}

function getSessionDiagnostics() {
  const session = shopify.session.currentSession;

  return {
    staffMemberId: stringify(session.staffMemberId),
    userId: stringify(session.userId),
    locationId: stringify(session.locationId),
    posVersion: stringify(session.posVersion),
    labels: pickStringFields(session, SESSION_LABEL_KEYS),
    keys: getTopLevelKeys(session),
  };
}

function getLineDiagnostics(line) {
  return {
    uuid: stringify(line.uuid),
    title: stringify(line.title),
    productTitle: stringify(readObjectValue(line, "productTitle")),
    properties: line.properties ?? {},
    customAttributes: readObjectValue(line, "customAttributes") ?? {},
    attributedUserId: stringify(line.attributedUserId),
    attributedStaffMemberId: stringify(line.attributedStaffMemberId),
    matchingAttributionFields: getMatchingTopLevelFields(line),
    labels: pickStringFields(line, LINE_LABEL_KEYS),
    keys: getTopLevelKeys(line),
  };
}

function getDiagnostics() {
  return {
    session: getSessionDiagnostics(),
    lines: (shopify.cart.current.value.lineItems ?? []).map(getLineDiagnostics),
  };
}

function DiagnosticsPanel() {
  const [expanded, setExpanded] = useState(false);
  const [diagnostics, setDiagnostics] = useState(getDiagnostics);

  useEffect(() => {
    return shopify.cart.current.subscribe(() => {
      setDiagnostics(getDiagnostics());
    });
  }, []);

  if (!ENABLE_DEV_DIAGNOSTICS) {
    return null;
  }

  return (
    <s-section
      heading="Diagnostics"
      secondaryActions={
        <s-button
          slot="secondary-actions"
          variant="secondary"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Hide" : "Show"}
        </s-button>
      }
    >
      {expanded ? (
        <s-stack direction="block" gap="small">
          <s-text>Dev-only POS session and cart discovery. Nothing is sent to ShopOps.</s-text>
          <s-heading>Session</s-heading>
          <s-text>{JSON.stringify(diagnostics.session, null, 2)}</s-text>
          <s-heading>Cart lines</s-heading>
          <s-text>{JSON.stringify(diagnostics.lines, null, 2)}</s-text>
        </s-stack>
      ) : (
        <s-text>Hidden</s-text>
      )}
    </s-section>
  );
}

function Extension() {
  const {i18n} = shopify;

  return (
    <s-page heading={i18n.translate("modal_heading")}>
      <s-scroll-box>
        <s-stack direction="block" gap="small" padding="small">
          <s-box padding="small">
            <s-text>{i18n.translate("modal_body")}</s-text>
          </s-box>
          <DiagnosticsPanel />
        </s-stack>
      </s-scroll-box>
    </s-page>
  );
}
