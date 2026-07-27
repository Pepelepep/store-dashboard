import { useEffect, useMemo, useRef, useState } from "react";
import {
  Form,
  useFetcher,
  useLocation,
  useNavigation,
} from "react-router";

import { formatRelativeUpdatedAt } from "../../lib/financial/cogs-setup";
import type {
  MissingProductCostsPageData,
  ProductCostSetupData,
} from "../../lib/financial/cogs-setup.server";
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
  if (!value) return "Timestamp unavailable";

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
  const location = useLocation();
  const navigation = useNavigation();
  const missingProductsFetcher = useFetcher<MissingProductCostsPageData>();
  const [enabled, setEnabled] = useState(data.settings.enabled);
  const [percent, setPercent] = useState(
    String(data.settings.percent ?? 40),
  );
  const [estimateCustomSales, setEstimateCustomSales] = useState(
    data.settings.estimateCustomSales,
  );
  const [search, setSearch] = useState(data.missingProducts.search);
  const [missingProducts, setMissingProducts] = useState(
    data.missingProducts,
  );
  const didMountSearch = useRef(false);

  useEffect(() => {
    setEnabled(data.settings.enabled);
    setPercent(String(data.settings.percent ?? 40));
    setEstimateCustomSales(data.settings.estimateCustomSales);
  }, [data.settings]);

  useEffect(() => {
    setMissingProducts(data.missingProducts);
    setSearch(data.missingProducts.search);
  }, [data.missingProducts]);

  useEffect(() => {
    if (missingProductsFetcher.data) {
      setMissingProducts(missingProductsFetcher.data);
    }
  }, [missingProductsFetcher.data]);

  function loadMissingProducts(page: number, nextSearch = search) {
    const searchParams = new URLSearchParams(location.search);
    searchParams.set("page", String(page));
    if (nextSearch.trim()) {
      searchParams.set("search", nextSearch.trim());
    } else {
      searchParams.delete("search");
    }
    missingProductsFetcher.load(
      `/app/admin/setup/missing-products?${searchParams.toString()}`,
    );
  }

  useEffect(() => {
    if (!didMountSearch.current) {
      didMountSearch.current = true;
      return;
    }

    const timeout = window.setTimeout(() => {
      loadMissingProducts(1, search);
    }, 300);

    return () => window.clearTimeout(timeout);
    // Only search changes should trigger the debounced request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const numericPercent = Number(percent);
  const percentIsValid =
    percent.trim() !== "" &&
    Number.isFinite(numericPercent) &&
    numericPercent >= 0 &&
    numericPercent <= 100;
  const settingsChanged =
    enabled !== data.settings.enabled ||
    (enabled &&
      (numericPercent !== data.settings.percent ||
        estimateCustomSales !== data.settings.estimateCustomSales));
  const isSaving =
    navigation.state !== "idle" &&
    navigation.formData?.get("intent") === "save-product-costs";
  const isLoadingMissingProducts = missingProductsFetcher.state !== "idle";
  const preview = useMemo(() => {
    const productEstimateCogs = percentIsValid
      ? data.previewBasis.productEstimateBasis * (numericPercent / 100)
      : 0;
    const customEstimateCogs =
      percentIsValid && estimateCustomSales
        ? data.previewBasis.customEstimateBasis * (numericPercent / 100)
        : 0;
    const affectedLineCount =
      data.previewBasis.productMissingLineCount +
      (estimateCustomSales ? data.previewBasis.customMissingLineCount : 0);
    const unresolvedLineCount = estimateCustomSales
      ? 0
      : data.previewBasis.customMissingLineCount;
    const estimatedCogs = productEstimateCogs + customEstimateCogs;
    const estimatedProfit =
      percentIsValid && unresolvedLineCount === 0
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
    estimateCustomSales,
    numericPercent,
    percentIsValid,
  ]);
  const confirmation = enabled
    ? `Apply a ${numericPercent}% estimated cost rate?\n\n${preview.affectedLineCount} sales lines will use estimated costs.\nExisting Shopify costs will not be changed.`
    : "Disable estimated product costs?\n\nEstimated rows will return to missing cost. Existing Shopify costs will not be changed.";
  const showingStart =
    missingProducts.totalCount === 0
      ? 0
      : (missingProducts.page - 1) * missingProducts.pageSize + 1;
  const showingEnd =
    showingStart === 0
      ? 0
      : Math.min(
          showingStart + missingProducts.rows.length - 1,
          missingProducts.totalCount,
        );

  return (
    <>
      <section
        style={{
          background: "white",
          border: "1px solid #e3e3e3",
          borderRadius: 16,
          marginBottom: 20,
          padding: 20,
        }}
      >
        <div
          style={{
            alignItems: "baseline",
            display: "flex",
            flexWrap: "wrap",
            gap: "6px 12px",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <h2 style={{ margin: 0 }}>Product cost coverage</h2>
          <span
            style={{ color: "#616161", fontSize: 13 }}
            title={formatTimestamp(data.coverage.lastCalculatedAt)}
          >
            {formatRelativeUpdatedAt(data.coverage.lastCalculatedAt)}
          </span>
        </div>
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
              label: "Products affected",
              value: formatNumber(data.coverage.affectedProductCount),
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
          if (isSaving || !settingsChanged) {
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
          <style>{`
            @media (max-width: 520px) {
              .cost-method-options {
                grid-template-columns: 1fr !important;
              }
            }
          `}</style>
          <div
            className="cost-method-options"
            style={{
              display: "grid",
              gap: 12,
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            }}
          >
            {[
              {
                enabled: false,
                title: "Shopify costs only",
                description:
                  "Products without a Shopify cost remain missing.",
              },
              {
                enabled: true,
                title: "Estimate missing costs",
                description:
                  "Apply your store rate only when Shopify has no product cost.",
              },
            ].map((option) => {
              const selected = enabled === option.enabled;

              return (
                <label
                  key={option.title}
                  style={{
                    alignItems: "flex-start",
                    background: selected ? "#eef5ff" : "white",
                    border: selected
                      ? "2px solid #2563eb"
                      : "1px solid #c9cccf",
                    borderRadius: 14,
                    cursor: "pointer",
                    display: "flex",
                    gap: 10,
                    minHeight: 82,
                    padding: 16,
                  }}
                >
                  <input
                    aria-label={option.title}
                    checked={selected}
                    name="missing_cost_method"
                    onChange={() => setEnabled(option.enabled)}
                    type="radio"
                    value={option.enabled ? "estimate" : "shopify-only"}
                  />
                  <span style={{ display: "grid", gap: 6 }}>
                    <strong>{option.title}</strong>
                    <span
                      style={{
                        color: "#616161",
                        fontSize: 13,
                        lineHeight: 1.4,
                      }}
                    >
                      {option.description}
                    </span>
                  </span>
                </label>
              );
            })}
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

              <label
                style={{
                  alignItems: "flex-start",
                  display: "flex",
                  gap: 10,
                }}
              >
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
          ) : data.coverage.missingLineCount > 0 ? (
            <div
              style={{
                background: "#fff8e5",
                border: "1px solid #e5c07b",
                borderRadius: 10,
                color: "#5c4813",
                fontSize: 13,
                marginTop: 18,
                padding: "10px 12px",
              }}
            >
              Profit remains unavailable while relevant product costs are
              missing.
            </div>
          ) : null}
        </section>

        {enabled ? (
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
        ) : null}

        <div
          style={{
            alignItems: "center",
            display: "flex",
            gap: 12,
            marginBottom: 24,
          }}
        >
          <AppButton
            disabled={
              isSaving ||
              !settingsChanged ||
              (enabled && !percentIsValid)
            }
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
        <h2 style={{ margin: 0 }}>Products missing costs</h2>
        <div
          style={{
            alignItems: "end",
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            justifyContent: "space-between",
            marginTop: 14,
          }}
        >
          <label
            style={{
              display: "grid",
              fontSize: 13,
              fontWeight: 700,
              gap: 6,
              maxWidth: 360,
              width: "100%",
            }}
          >
            Search
            <input
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search product or variant"
              style={{
                border: "1px solid #c9cccf",
                borderRadius: 8,
                padding: 10,
                width: "100%",
              }}
              type="search"
              value={search}
            />
          </label>
          <div aria-live="polite" style={{ color: "#616161", fontSize: 13 }}>
            {isLoadingMissingProducts
              ? "Loading..."
              : `Showing ${formatNumber(showingStart)}–${formatNumber(
                  showingEnd,
                )} of ${formatNumber(missingProducts.totalCount)}`}
          </div>
        </div>
        <div style={{ marginTop: 12, overflowX: "auto" }}>
          <table
            style={{ borderCollapse: "collapse", fontSize: 14, width: "100%" }}
          >
            <thead>
              <tr>
                {[
                  "Product",
                  "Variant",
                  "Units sold",
                  "Sales affected",
                  "Action",
                ].map((header) => (
                  <th
                    key={header}
                    style={{
                      background: "white",
                      borderBottom: "1px solid #ddd",
                      padding: 10,
                      position: "sticky",
                      textAlign: "left",
                      top: 0,
                      whiteSpace: "nowrap",
                      zIndex: 1,
                    }}
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {missingProducts.rows.map((row) => (
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
              {missingProducts.rows.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ color: "#616161", padding: 16 }}>
                    {search
                      ? "No missing-cost products match this search."
                      : "All synced sales lines have product costs."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div
          style={{
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
            marginTop: 14,
          }}
        >
          <AppButton
            compact
            disabled={isLoadingMissingProducts || missingProducts.page <= 1}
            onClick={() =>
              loadMissingProducts(missingProducts.page - 1)
            }
            type="button"
            variant="secondary"
          >
            Previous
          </AppButton>
          <AppButton
            compact
            disabled={
              isLoadingMissingProducts ||
              showingEnd >= missingProducts.totalCount
            }
            onClick={() =>
              loadMissingProducts(missingProducts.page + 1)
            }
            type="button"
            variant="secondary"
          >
            Next
          </AppButton>
        </div>
      </section>
    </>
  );
}
