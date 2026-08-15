import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getCachedReportingQuery,
  reportingCacheKey,
} from "../db/reporting-query-cache.server";
import { fetchAllSupabasePages } from "../db/supabase-pagination.server";
import type {
  DashboardFilterOption,
  OrderLineDbRow,
} from "../dashboard/dashboard-types";

type ReportingFilterOptions = {
  staff: DashboardFilterOption[];
  vendors: DashboardFilterOption[];
};

export async function fetchReportingFilterOptions({
  supabase,
  shop,
  locationIds,
  startAt,
  endAt,
}: {
  supabase: SupabaseClient;
  shop: string;
  locationIds: string[];
  startAt: string;
  endAt: string;
}) {
  if (locationIds.length === 0) {
    return { staff: [], vendors: [] } satisfies ReportingFilterOptions;
  }

  return getCachedReportingQuery(
    reportingCacheKey("report-filter-options", [
      shop,
      [...locationIds].sort(),
      startAt,
      endAt,
    ]),
    async () => {
      const { data, error } = await supabase.rpc(
        "get_reporting_filter_options",
        {
          p_shop_domain: shop,
          p_location_ids: locationIds,
          p_start_at: startAt,
          p_end_at: endAt,
        },
      );
      if (error) {
        throw new Error(`Reporting filter options: ${error.message}`);
      }

      const options = (data ?? {}) as Partial<ReportingFilterOptions>;
      return {
        staff: Array.isArray(options.staff) ? options.staff : [],
        vendors: Array.isArray(options.vendors) ? options.vendors : [],
      } satisfies ReportingFilterOptions;
    },
  );
}

export async function fetchReportingOrderLines({
  supabase,
  shop,
  locationIds,
  startAt,
  endAt,
  selectedStaff,
  selectedVendor,
  selectColumns,
  cacheNamespace,
  maxRows,
}: {
  supabase: SupabaseClient;
  shop: string;
  locationIds: string[];
  startAt: string;
  endAt: string;
  selectedStaff: string;
  selectedVendor: string;
  selectColumns: string;
  cacheNamespace: string;
  maxRows: number;
}) {
  if (locationIds.length === 0) return [];

  return getCachedReportingQuery(
    reportingCacheKey(cacheNamespace, [
      shop,
      [...locationIds].sort(),
      startAt,
      endAt,
      selectedStaff,
      selectedVendor,
      selectColumns,
    ]),
    () =>
      fetchAllSupabasePages<OrderLineDbRow & { id: string }>({
        label: "Filtered reporting order lines",
        maxRows,
        pageConcurrency: 4,
        getRowKey: (row) => row.id,
        fetchPage: (from, to) =>
          supabase
            .rpc("get_reporting_order_lines", {
              p_shop_domain: shop,
              p_location_ids: locationIds,
              p_start_at: startAt,
              p_end_at: endAt,
              p_staff_key: selectedStaff || null,
              p_vendor: selectedVendor || null,
            })
            .select(selectColumns)
            .order("created_at_shopify", { ascending: false })
            .order("id", { ascending: true })
            .range(from, to) as unknown as PromiseLike<{
            data: Array<OrderLineDbRow & { id: string }> | null;
            error: { message: string } | null;
          }>,
      }),
  );
}
