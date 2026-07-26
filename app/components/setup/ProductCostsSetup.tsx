import { useMemo, useState } from "react";
import { Form, useNavigation } from "react-router";

import type { ProductCostSetupData } from "../../lib/financial/cogs-setup.server";
import { AppButton } from "../ui/AppButton";
import { HelperText } from "../ui/HelperText";
import { InlineResult } from "../ui/InlineResult";

type ProductCostsSetupProps = {
  shop: string;
  data: ProductCostSetupData;
  actionData?: {
    ok: boolean;
    intent?: string;
    message?: string;
  };
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("fr-CA", {
    style: "currency",
    currency: "CAD",
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("fr-CA").format(value);
}

function formatTimestamp(value: string | null) {
  if (!value) return "Not available";

  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getShopifyAdminProductUrl(shop: string, productId: string) {
  const numericId = productId.split("/").pop();
  return `https://${shop}/admin/products/${encodeURIComponent(numericId ?? productId)}`;
}

export function ProductCostsSetup({
  shop,
  data,
  actionData,
}: ProductCostsSetupProps) {
  const navigation = useNavigation();
  const [enabled, setEnabled] = useState(data.settings.enabled);
  const [percent, setPercent] = useState(
    String(data.settings.percent ?? 40),
  );
  const [estimateCustomSales, setEstimateCustomSales] = useState(
    data.settings.estimateCustomSales,
  );
  const numericPercent = Number(percent);
  const percentIsValid =
    percent.trim() !== "" &&
    Number.isFinite(numericPercent) &&
    numericPercent >= 0 &&
    numericPercent <= 100;
  const isSaving =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "save-product-costs";
  const preview = useMemo(() => {
    const productEstimateCogs = percentIsValid
      ? data.previewBasis.productEstimateBasis * (numericPercent / 100)
      : 0;
    const customEstimateCogs =
      percentIsValid && estimateCustomSales
        ? data.previewBasis.customEstimateBasis * (numericPercent / 100)
        : 0;
    const affectedLineCount = enabled
      ? data.previewBasis.productMissingLineCount +
        (estimateCustomSales
          ? data.previewBasis.customMissingLineCount
          : 0)
      : 0;
    const unresolvedLineCount = enabled
      ? estimateCustomSales
        ? 0
        : data.previewBasis.customMissingLineCount
      : data.previewBasis.productMissingLineCount +
        data.previewBasis.customMissingLineCount;
    const estimatedCogs = enabled
      ? productEstimateCogs + customEstimateCogs
      : 0;
    const estimatedProfit =
      enabled && percentIsValid && unresolvedLineCount === 0
        ? data.previewBasis.totalNetSales -
          data.previewBasis.actualCogs -
          estimatedCogs
        : null;

    return {
      affectedLineCount,
      estimatedCogs,
      estimatedProfit,
    };
  }, [
    data.previewBasis,
    enabled,
    estimateCustomSales,
    numericPercent,
    percentIsValid,
  ]);
  const confirmation = enabled
    ? `Apply a ${numericPercent}% estimated cost rate?\n\n${preview.affectedLineCount} sales lines will use estimated costs.\nExisting Shopify costs will not be changed.`
    : "Disable estimated product costs?\n\nEstimated rows will return to missing cost. Existing Shopify costs will not be changed.";

  return (
    <>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 32, margin: 0 }}>Product costs</h1>
        <p style={{ color: "#616161", margin: "8px 0 0" }}>
          Review product cost coverage and choose how ShopOps handles missing
          costs.
        </p>
      </header>

      <section
        style={{
          background: "white",
          border: "1px solid #e3e3e3",
          borderRadius: 16,
          marginBottom: 20,
          padding: 20,
        }}
      >
        <h2 style={{ marginTop: 0 }}>Product cost coverage</h2>
        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          }}
        >
          {[
            {
              label: "Using Shopify costs",
              value: formatNumber(data.coverage.actualLineCount),
            },
            {
              label: "Using ShopOps estimates",
              value: formatNumber(data.coverage.estimatedLineCount),
            },
            {
              label: "Missing costs",
              value: formatNumber(data.coverage.missingLineCount),
            },
            {
              label: "Sales affected",
              value: formatCurrency(data.coverage.missingSalesAmount),
            },
            {
              label: "Affected products or variants",
              value: formatNumber(data.coverage.affectedProductCount),
            },
            {
              label: "Last calculated",
              value: formatTimestamp(data.coverage.lastCalculatedAt),
            },
          ].map((item) => (
            <div
              key={item.label}
              style={{
                background: "#f8fafc",
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                padding: 14,
              }}
            >
              <div style={{ color: "#616161", fontSize: 12, fontWeight: 700 }}>
                {item.label}
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, marginTop: 5 }}>
                {item.value}
              </div>
            </div>
          ))}
        </div>
      </section>

      <Form
        method="post"
        onSubmit={(event) => {
          if (isSaving) {
            event.preventDefault();
            return;
          }

          if (!window.confirm(confirmation)) event.preventDefault();
        }}
      >
        <input type="hidden" name="intent" value="save-product-costs" />
        <input type="hidden" name="estimate_enabled" value={String(enabled)} />
        <input type="hidden" name="estimate_percent" value={percent} />
        <input
          type="hidden"
          name="estimate_custom_sales"
          value={String(estimateCustomSales)}
        />

        <section
          style={{
            background: "white",
            border: "1px solid #e3e3e3",
            borderRadius: 16,
            marginBottom: 20,
            padding: 20,
          }}
        >
          <h2 style={{ marginTop: 0 }}>Missing-cost method</h2>
          <div style={{ display: "grid", gap: 12 }}>
            <label style={{ alignItems: "flex-start", display: "flex", gap: 10 }}>
              <input
                aria-label="Use Shopify costs only"
                checked={!enabled}
                name="missing_cost_method"
                onChange={() => setEnabled(false)}
                type="radio"
                value="shopify-only"
              />
              <span>
                <strong>Use Shopify costs only</strong>
                <HelperText>
                  Products without a Shopify cost remain missing.
                </HelperText>
              </span>
            </label>
            <label style={{ alignItems: "flex-start", display: "flex", gap: 10 }}>
              <input
                aria-label="Estimate missing costs"
                checked={enabled}
                name="missing_cost_method"
                onChange={() => setEnabled(true)}
                type="radio"
                value="estimate"
              />
              <span>
                <strong>Estimate missing costs</strong>
                <HelperText>
                  Shopify costs always take priority over estimates.
                </HelperText>
              </span>
            </label>
          </div>

          {enabled ? (
            <div
              style={{
                borderTop: "1px solid #e5e7eb",
                display: "grid",
                gap: 18,
                marginTop: 18,
                paddingTop: 18,
              }}
            >
              <label
                style={{
                  display: "grid",
                  fontWeight: 700,
                  gap: 6,
                  maxWidth: 280,
                }}
              >
                Estimated cost rate
                <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
                  <input
                    max="100"
                    min="0"
                    onChange={(event) => setPercent(event.target.value)}
                    required
                    step="0.1"
                    style={{
                      border: percentIsValid
                        ? "1px solid #c9cccf"
                        : "1px solid #d92d20",
                      borderRadius: 8,
                      padding: 10,
                      width: 120,
                    }}
                    type="number"
                    value={percent}
                  />
                  <span>%</span>
                </div>
                <HelperText>
                  Estimated unit cost uses selling price before discounts.
                </HelperText>
              </label>

              <label style={{ alignItems: "flex-start", display: "flex", gap: 10 }}>
                <input
                  aria-label="Estimate costs for custom sales"
                  checked={estimateCustomSales}
                  onChange={(event) =>
                    setEstimateCustomSales(event.target.checked)
                  }
                  type="checkbox"
                />
                <span>
                  <strong>Estimate costs for custom sales</strong>
                  <HelperText>
                    Enable this only when custom sales generally represent
                    physical products.
                  </HelperText>
                </span>
              </label>
            </div>
          ) : null}
        </section>

        <section
          style={{
            background: "white",
            border: "1px solid #e3e3e3",
            borderRadius: 16,
            marginBottom: 20,
            padding: 20,
          }}
        >
          <h2 style={{ marginTop: 0 }}>Estimated impact preview</h2>
          <div
            style={{
              display: "grid",
              gap: 12,
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            }}
          >
            <div>
              <HelperText>Affected sales lines</HelperText>
              <strong>{formatNumber(preview.affectedLineCount)}</strong>
            </div>
            <div>
              <HelperText>Estimated COGS</HelperText>
              <strong>{formatCurrency(preview.estimatedCogs)}</strong>
            </div>
            <div>
              <HelperText>Estimated profit</HelperText>
              <strong>
                {preview.estimatedProfit === null
                  ? "Not calculable"
                  : formatCurrency(preview.estimatedProfit)}
              </strong>
            </div>
          </div>
          <HelperText>This preview is not saved until you confirm.</HelperText>
        </section>

        <div
          style={{
            alignItems: "center",
            display: "flex",
            gap: 12,
            marginBottom: 24,
          }}
        >
          <AppButton
            disabled={isSaving || (enabled && !percentIsValid)}
            type="submit"
            variant="primary"
          >
            {isSaving ? "Saving and recalculating..." : "Save and recalculate"}
          </AppButton>
          {actionData?.intent === "save-product-costs" && actionData.message ? (
            <InlineResult variant={actionData.ok ? "success" : "error"}>
              {actionData.message}
            </InlineResult>
          ) : null}
        </div>
      </Form>

      <section
        style={{
          background: "white",
          border: "1px solid #e3e3e3",
          borderRadius: 16,
          padding: 20,
        }}
      >
        <h2 style={{ marginTop: 0 }}>Products missing costs</h2>
        <HelperText>
          Highest affected sales amounts are shown first. Add costs in Shopify
          when available.
        </HelperText>
        <div style={{ marginTop: 12, overflowX: "auto" }}>
          <table
            style={{ borderCollapse: "collapse", fontSize: 14, width: "100%" }}
          >
            <thead>
              <tr>
                {["Product", "Variant", "Units sold", "Sales affected", "Action"].map(
                  (header) => (
                    <th
                      key={header}
                      style={{
                        borderBottom: "1px solid #ddd",
                        padding: 10,
                        textAlign: "left",
                      }}
                    >
                      {header}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {data.missingProducts.map((row) => (
                <tr key={row.key}>
                  <td style={{ borderBottom: "1px solid #eee", padding: 10 }}>
                    {row.product}
                  </td>
                  <td style={{ borderBottom: "1px solid #eee", padding: 10 }}>
                    {row.variant}
                  </td>
                  <td style={{ borderBottom: "1px solid #eee", padding: 10 }}>
                    {formatNumber(row.unitsSold)}
                  </td>
                  <td style={{ borderBottom: "1px solid #eee", padding: 10 }}>
                    {formatCurrency(row.salesAffected)}
                  </td>
                  <td style={{ borderBottom: "1px solid #eee", padding: 10 }}>
                    {row.shopifyProductId ? (
                      <a
                        href={getShopifyAdminProductUrl(
                          shop,
                          row.shopifyProductId,
                        )}
                        style={{ color: "#2563eb", fontWeight: 700 }}
                        target="_top"
                      >
                        Open in Shopify
                      </a>
                    ) : (
                      <span style={{ color: "#8a8f93" }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
              {data.missingProducts.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ color: "#616161", padding: 16 }}>
                    All synced sales lines have product costs.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
