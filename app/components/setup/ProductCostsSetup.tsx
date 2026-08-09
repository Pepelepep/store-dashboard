import { useEffect, useMemo, useRef, useState } from "react";
import { Form, useFetcher, useLocation, useNavigation } from "react-router";

import { formatRelativeUpdatedAt } from "../../lib/financial/cogs-setup";
import type {
  MissingProductCostRow,
  MissingProductCostsPageData,
  ProductCostSetupData,
} from "../../lib/financial/cogs-setup.server";
import { AppButton } from "../ui/AppButton";
import { HelperText } from "../ui/HelperText";
import { InlineResult } from "../ui/InlineResult";
import {
  SortableDataTable,
  type SortableDataTableColumn,
} from "../ui/SortableDataTable";
import {
  ContentCard,
  EmptyState,
  FormActions,
  InlineNotice,
  SelectableCard,
  SummaryCard,
} from "../ui/ShopOpsPage";

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
  const [percent, setPercent] = useState(String(data.settings.percent ?? 40));
  const [estimateCustomSales, setEstimateCustomSales] = useState(
    data.settings.estimateCustomSales,
  );
  const [search, setSearch] = useState(data.missingProducts.search);
  const [missingProducts, setMissingProducts] = useState(data.missingProducts);
  const didMountSearch = useRef(false);
  const missingProductColumns: SortableDataTableColumn<MissingProductCostRow>[] =
    [
      {
        key: "product",
        label: "Product",
        render: (row) => row.product,
        sortValue: (row) => row.product,
      },
      {
        key: "variant",
        label: "Variant",
        render: (row) => row.variant,
        sortValue: (row) => row.variant,
      },
      {
        align: "right",
        key: "unitsSold",
        label: "Units sold",
        render: (row) => formatNumber(row.unitsSold),
        sortValue: (row) => row.unitsSold,
      },
      {
        align: "right",
        key: "salesAffected",
        label: "Sales missing costs",
        render: (row) => formatCurrency(row.salesAffected),
        sortValue: (row) => row.salesAffected,
      },
      {
        key: "action",
        label: "Action",
        render: (row) =>
          row.shopifyProductId ? (
            <a
              href={getShopifyAdminProductUrl(shop, row.shopifyProductId)}
              className="shopops-link"
              target="_top"
            >
              Open in Shopify
            </a>
          ) : (
            <span className="shopops-muted">—</span>
          ),
      },
    ];

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
  }, [data.previewBasis, estimateCustomSales, numericPercent, percentIsValid]);
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
  const coveredLineCount =
    data.coverage.actualLineCount + data.coverage.estimatedLineCount;
  const totalLineCount = coveredLineCount + data.coverage.missingLineCount;

  return (
    <>
      <div className="shopops-summary-grid">
        <SummaryCard
          label="Cost coverage"
          value={`${formatNumber(coveredLineCount)} of ${formatNumber(totalLineCount)} sales lines`}
          detail={
            <span title={formatTimestamp(data.coverage.lastCalculatedAt)}>
              {formatNumber(data.coverage.actualLineCount)} Shopify ·{" "}
              {formatNumber(data.coverage.estimatedLineCount)} estimated ·{" "}
              {formatRelativeUpdatedAt(data.coverage.lastCalculatedAt)}
            </span>
          }
        />
        <SummaryCard
          label="Products missing costs"
          value={formatNumber(data.coverage.affectedProductCount)}
          detail={`${formatNumber(data.coverage.missingLineCount)} sales lines · ${formatCurrency(data.coverage.missingSalesAmount)} in sales`}
          tone={data.coverage.missingLineCount > 0 ? "warning" : "neutral"}
        />
      </div>

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

        <ContentCard title="How to handle missing costs">
          <div className="shopops-selectable-grid">
            {[
              {
                enabled: false,
                title: "Shopify costs only",
                description: "Products without a Shopify cost remain missing.",
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
                <SelectableCard
                  key={option.title}
                  input={{
                    "aria-label": option.title,
                    checked: selected,
                    name: "missing_cost_method",
                    onChange: () => setEnabled(option.enabled),
                    type: "radio",
                    value: option.enabled ? "estimate" : "shopify-only",
                  }}
                >
                  <span className="shopops-form-stack">
                    <strong>{option.title}</strong>
                    <span className="shopops-helper-text">
                      {option.description}
                    </span>
                  </span>
                </SelectableCard>
              );
            })}
          </div>

          {enabled ? (
            <div className="shopops-form-option-details">
              <label className="shopops-form-field shopops-form-field--compact">
                Estimated cost rate
                <div className="shopops-form-control-row">
                  <input
                    max="100"
                    min="0"
                    onChange={(event) => setPercent(event.target.value)}
                    required
                    step="0.1"
                    className="shopops-form-control shopops-form-control--short"
                    data-invalid={!percentIsValid}
                    type="number"
                    value={percent}
                  />
                  <span>%</span>
                </div>
                <HelperText>
                  Estimated unit cost uses selling price before discounts.
                </HelperText>
              </label>

              <label className="shopops-checkbox-field">
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
            <div className="shopops-notice-spaced">
              <InlineNotice tone="warning">
                Profit remains unavailable while relevant product costs are
                missing.
              </InlineNotice>
            </div>
          ) : null}

          {enabled ? (
            <section
              aria-labelledby="estimated-impact-preview-title"
              className="shopops-preview"
            >
              <h3 id="estimated-impact-preview-title">
                Estimated impact preview
              </h3>
              <div className="shopops-preview-grid product-cost-preview-grid">
                <div className="shopops-preview-cell">
                  <HelperText>Affected sales lines</HelperText>
                  <strong className="shopops-preview-value">
                    {formatNumber(preview.affectedLineCount)}
                  </strong>
                </div>
                <div className="shopops-preview-cell">
                  <HelperText>Estimated COGS</HelperText>
                  <strong className="shopops-preview-value">
                    {formatCurrency(preview.estimatedCogs)}
                  </strong>
                </div>
                <div className="shopops-preview-cell">
                  <HelperText>Estimated profit</HelperText>
                  <strong className="shopops-preview-value">
                    {preview.estimatedProfit === null
                      ? "Not calculable"
                      : formatCurrency(preview.estimatedProfit)}
                  </strong>
                </div>
              </div>
              <div className="shopops-preview-note">
                <HelperText>
                  This preview is not saved until you confirm.
                </HelperText>
              </div>
            </section>
          ) : null}

          <FormActions
            equal={false}
            feedback={
              actionData?.intent === "save-product-costs" &&
              actionData.message ? (
                <InlineResult variant={actionData.ok ? "success" : "error"}>
                  {actionData.message}
                </InlineResult>
              ) : enabled && !percentIsValid ? (
                <HelperText>
                  Enter an estimated cost rate from 0 to 100.
                </HelperText>
              ) : !settingsChanged ? (
                <HelperText>Make a change to enable saving.</HelperText>
              ) : undefined
            }
          >
            <AppButton
              disabled={
                isSaving || !settingsChanged || (enabled && !percentIsValid)
              }
              type="submit"
              variant="primary"
            >
              {isSaving
                ? "Saving and recalculating..."
                : "Save and recalculate"}
            </AppButton>
          </FormActions>
        </ContentCard>
      </Form>

      <ContentCard title="Products missing costs">
        <div className="shopops-table-toolbar">
          <label className="shopops-form-field shopops-table-search">
            Search
            <input
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search product or variant"
              className="shopops-form-control"
              type="search"
              value={search}
            />
          </label>
          <div aria-live="polite" className="shopops-helper-text">
            {isLoadingMissingProducts
              ? "Loading..."
              : `Showing ${formatNumber(showingStart)}–${formatNumber(
                  showingEnd,
                )} of ${formatNumber(missingProducts.totalCount)}`}
          </div>
        </div>
        <div className="shopops-data-table-scroll--spaced">
          <SortableDataTable
            ariaLabel="Products missing costs"
            columns={missingProductColumns}
            defaultSort={{ key: "salesAffected", direction: "desc" }}
            emptyMessage={
              <EmptyState
                title={
                  search
                    ? "No missing-cost products match this search."
                    : "All synced sales lines have product costs."
                }
              />
            }
            getRowKey={(row) => row.key}
            rows={missingProducts.rows}
          />
        </div>
        <div className="shopops-table-pagination">
          <AppButton
            compact
            disabled={isLoadingMissingProducts || missingProducts.page <= 1}
            onClick={() => loadMissingProducts(missingProducts.page - 1)}
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
            onClick={() => loadMissingProducts(missingProducts.page + 1)}
            type="button"
            variant="secondary"
          >
            Next
          </AppButton>
        </div>
      </ContentCard>
    </>
  );
}
