export type LocationRow = {
  shopify_location_id: string;
  name: string;
  is_active: boolean;
};

export type OrderLineDbRow = {
  order_name: string;
  shopify_order_id: string;
  created_at_shopify: string;
  retail_location_id: string | null;
  retail_location_name: string | null;
  product_title: string | null;
  variant_title: string | null;
  sku: string | null;
  vendor: string | null;
  quantity: number;
  unit_price: number;
  revenue: number;
  unit_cost: number | null;
  cogs: number | null;
  gross_profit: number | null;
  cost_source: string | null;
  staff_member_id: string | null;
  staff_member_name: string | null;
  staff_member_email: string | null;
  staff_source: string | null;
};

export type InventoryLevelDbRow = {
  shopify_location_id: string;
  shopify_variant_id: string | null;
  inventory_item_id: string;
  sku: string | null;
  available: number;
  tracked: boolean;
};

export type VariantDbRow = {
  shopify_variant_id: string;
  shopify_product_id: string | null;
  inventory_item_id: string | null;
  title: string | null;
  sku: string | null;
  unit_cost: number | null;
};

export type ProductDbRow = {
  shopify_product_id: string;
  title: string;
  vendor: string | null;
  status: string | null;
};

export type FixedExpenseDbRow = {
  expense_name: string;
  expense_category: string | null;
  monthly_amount: number;
  shopify_location_id: string | null;
  location_name: string | null;
  start_month: string;
  end_month: string | null;
  is_active: boolean;
};

export type BestSellerRow = {
  product: string;
  sku: string;
  vendor: string;
  units: number;
  revenue: number;
};

export type VendorRow = {
  vendor: string;
  units: number;
  revenue: number;
};

export type StaffSalesRow = {
  staff: string;
  staffId: string;
  source: string;
  units: number;
  revenue: number;
};

export type SalesByHourRow = {
  hour: number;
  revenue: number;
  unitsSold: number;
  ordersCount: number;
  averageOrderValue: number;
};

export type StockAlertRow = {
  product: string;
  variant: string;
  sku: string;
  vendor: string;
  available: number;
  unitsSold: number;
  daysLeft: number | null;
  status: "Critical" | "Warning" | "Healthy" | "No sales";
};

export type RecentOrderRow = {
  orderName: string;
  orderUrl: string;
  date: string;
  product: string;
  sku: string;
  quantity: number;
  revenue: number;
  cogs: number | null;
  grossProfit: number | null;
  costSource: string;
};

export type DashboardFilterOption = {
  value: string;
  label: string;
};

export type DashboardLoaderData = {
  shop: string;
  locations: LocationRow[];
  selectedLocationId: string | null;
  selectedLocationName: string | null;
  selectedStaff: string;
  selectedVendor: string;
  staffOptions: DashboardFilterOption[];
  vendorOptions: DashboardFilterOption[];
  startDate: string;
  endDate: string;
  preservedSearchParams: Array<{ name: string; value: string }>;
  lastSuccessfulSync: string | null;
  selectedDays: number;
  kpis: {
    revenue: number;
    cogs: number;
    grossProfit: number;
    grossMarginPct: number | null;
    ordersCount: number;
    unitsSold: number;
    averageOrderValue: number;
    inventoryUnits: number;
    criticalStockCount: number;
    expenses: number | null;
    netProfit: number | null;
  };
  bestSellers: BestSellerRow[];
  salesByVendor: VendorRow[];
  salesByStaff: StaffSalesRow[];
  salesByHour: SalesByHourRow[];
  stockAlerts: StockAlertRow[];
  recentOrders: RecentOrderRow[];
  errors: string[];
};
