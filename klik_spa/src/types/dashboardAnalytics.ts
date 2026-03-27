export interface DashboardSummary {
  /** Net sales (items + charges, excl. tax) — aligns with COGS-based profit */
  total_revenue: number
  total_cost: number
  gross_profit: number
  /** Margin on net sales: gross_profit / total_revenue * 100 */
  gross_margin_pct: number
  total_transactions: number
  avg_order_value: number
  total_items_sold: number
  total_bill_discount: number
  total_line_discount: number
  total_discounts: number
  discount_invoice_count: number
  currency: string
}

export interface DashboardProductRow {
  item_code: string
  item_name: string
  qty_sold: number
  revenue: number
  cost: number
  gross_profit: number
  /** Margin on sales: (revenue − cost) / revenue * 100 */
  margin_pct: number
  discount: number
}

export interface DashboardCustomerRow {
  customer: string
  customer_name: string
  transaction_count: number
  qty_bought: number
  revenue: number
  cost: number
  gross_profit: number
  margin_pct: number
}

export interface DashboardTransactionRow {
  name: string
  customer_name: string
  posting_date: string
  posting_time: string
  revenue: number
  cost: number
  gross_profit: number
  margin_pct: number
  discount_amount: number
}

export interface DashboardCashierRow {
  owner: string
  cashier_name: string
  qty_sold: number
  transaction_count: number
  unique_customers: number
  revenue: number
  discount: number
  cost: number
  gross_profit: number
  margin_pct: number
}

export interface SalesByHourPoint {
  hour: string
  revenue: number
  profit: number
}

export interface DiscountTopItem {
  item_code: string
  item_name: string
  discount: number
}

export interface PaymentMethodRow {
  method: string
  amount: number
  transactions: number
  percentage: number
}

export interface ZatcaBreakdownRow {
  status: string
  count: number
  percentage: number
}

export interface DashboardAnalyticsData {
  summary: DashboardSummary
  products: DashboardProductRow[]
  products_top: DashboardProductRow[]
  /** Top 10 by revenue across all POS invoices (no date/cashier/payment filter) */
  products_top_alltime: DashboardProductRow[]
  customers: DashboardCustomerRow[]
  customers_top: DashboardCustomerRow[]
  customers_top_alltime: DashboardCustomerRow[]
  transactions: DashboardTransactionRow[]
  sales_by_hour: SalesByHourPoint[]
  discount_top_items: DiscountTopItem[]
  payment_methods: PaymentMethodRow[]
  zatca_breakdown: ZatcaBreakdownRow[]
  cashiers: DashboardCashierRow[]
}
