import "@shopify/ui-extensions/preact";
import {render} from "preact";

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const {i18n} = shopify;

  return (
    <s-page heading={i18n.translate("modal_heading")}>
      <s-scroll-box>
        <s-stack direction="block" gap="small" padding="small">
          <s-box padding="small">
            <s-text>{i18n.translate("modal_body")}</s-text>
          </s-box>
          <s-box padding="small">
            <s-text>{i18n.translate("modal_status")}</s-text>
          </s-box>
        </s-stack>
      </s-scroll-box>
    </s-page>
  );
}
