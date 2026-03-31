import { useCallback, useEffect, useState } from "react"
import type { DashboardAnalyticsData } from "../types/dashboardAnalytics"

function emptyData(currency = "USD"): DashboardAnalyticsData {
  return {
    summary: {
      total_revenue: 0,
      total_cost: 0,
      gross_profit: 0,
      gross_margin_pct: 0,
      total_transactions: 0,
      avg_order_value: 0,
      total_items_sold: 0,
      total_bill_discount: 0,
      total_line_discount: 0,
      total_discounts: 0,
      discount_invoice_count: 0,
      currency,
    },
    products: [],
    products_top: [],
    products_top_alltime: [],
    customers: [],
    customers_top: [],
    customers_top_alltime: [],
    transactions: [],
    sales_by_hour: [],
    discount_top_items: [],
    payment_methods: [],
    zatca_breakdown: [],
    cashiers: [],
  }
}

export type DashboardTimeRange = "today" | "yesterday" | "week" | "month" | "session"

export function useDashboardAnalytics(
  timeRange: DashboardTimeRange,
  cashierFilter: string,
  paymentFilter: string
) {
  const [data, setData] = useState<DashboardAnalyticsData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAnalytics = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set("time_range", timeRange)
      if (cashierFilter && cashierFilter !== "all") {
        params.set("cashier_name", cashierFilter)
      }
      if (paymentFilter && paymentFilter !== "all") {
        params.set("payment_method", paymentFilter)
      }
      params.set("include_alltime_top10", "1")

      const res = await fetch(
        `/api/method/klik_pos.api.sales_invoice.get_dashboard_analytics?${params.toString()}`,
        {
          method: "GET",
          headers: { Accept: "application/json" },
          credentials: "include",
        }
      )
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const json = await res.json()
      const message = json.message
      if (!message?.success) {
        throw new Error(message?.error || json.exc || "Failed to load dashboard")
      }
      const d = message as DashboardAnalyticsData & { success: boolean }
      setData({
        summary: d.summary,
        products: d.products ?? [],
        products_top: d.products_top ?? [],
        products_top_alltime: d.products_top_alltime ?? [],
        customers: d.customers ?? [],
        customers_top: d.customers_top ?? [],
        customers_top_alltime: d.customers_top_alltime ?? [],
        transactions: d.transactions ?? [],
        sales_by_hour: d.sales_by_hour ?? [],
        discount_top_items: d.discount_top_items ?? [],
        payment_methods: d.payment_methods ?? [],
        zatca_breakdown: d.zatca_breakdown ?? [],
        cashiers: d.cashiers ?? [],
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error")
      setData(emptyData())
    } finally {
      setIsLoading(false)
    }
  }, [timeRange, cashierFilter, paymentFilter])

  useEffect(() => {
    fetchAnalytics()
  }, [fetchAnalytics])

  return { data, isLoading, error, refetch: fetchAnalytics }
}
