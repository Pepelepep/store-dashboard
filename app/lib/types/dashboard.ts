export type ProductRow = {
  productId: string;
  variantId: string;
  title: string;
  variantTitle: string;
  vendor: string;
  productType: string;
  sku: string;
  price: number;
  updatedAt?: string;
};

export type OrderLineRow = {
  orderId: string;
  orderName: string;
  createdAt: string;
  financialStatus: string;
  lineItemId: string;
  variantId?: string;
  sku?: string;
  quantity: number;
  unitPrice: number;
  revenue: number;
};

export type InventoryRow = {
  productId: string;
  productTitle: string;
  variantId: string;
  sku?: string;
  inventoryItemId: string;
  locationId: string;
  locationName: string;
  available: number;
  updatedAt?: string;
};

export type DashboardKpis = {
  revenue: number;
  ordersCount: number;
  unitsSold: number;
  averageOrderValue: number;
  grossProfit?: number;
  grossMarginPct?: number;
};