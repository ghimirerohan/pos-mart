import { useEffect, useMemo, useState } from "react"
import { Filter } from "lucide-react"
import type { SalesInvoice } from "../../types"

import BottomNavigation from "../components/BottomNavigation"
import { CashierPerformance } from "../components/dashboard/CashierPerformance"
import { DiscountSummary } from "../components/dashboard/DiscountSummary"
import { KPICards } from "../components/dashboard/KPICards"
import { PaymentMethodsPanel } from "../components/dashboard/PaymentMethodsPanel"
import { SalesListingTabs } from "../components/dashboard/SalesListingTabs"
import { SalesByHourChart } from "../components/dashboard/SalesByHourChart"
import { TopCustomersTable } from "../components/dashboard/TopCustomersTable"
import { TopItemsTable } from "../components/dashboard/TopItemsTable"
import { ZatcaStatusPanel } from "../components/dashboard/ZatcaStatusPanel"
import { useMediaQuery } from "../hooks/useMediaQuery"
import type { DashboardTimeRange } from "../hooks/useDashboardAnalytics"
import { useDashboardAnalytics } from "../hooks/useDashboardAnalytics"
import { usePOSDetails } from "../hooks/usePOSProfile"
import { useSalesInvoices } from "../hooks/useSalesInvoices"
import { useUserInfo } from "../hooks/useUserInfo"

function postingPresetForInvoices(tr: DashboardTimeRange): string | undefined {
  if (tr === "session") return undefined
  return tr
}

export default function DashboardPage() {
  const isMobile = useMediaQuery("(max-width: 1024px)")
  const { posDetails } = usePOSDetails()

  const [timeRange, setTimeRange] = useState<DashboardTimeRange>("today")
  const [cashierFilter, setCashierFilter] = useState("all")
  const [paymentFilter, setPaymentFilter] = useState("all")
  const [showFilters, setShowFilters] = useState(!isMobile)

  const invoiceDatePreset = postingPresetForInvoices(timeRange)
  const { invoices, isLoading: invoicesLoading } = useSalesInvoices(
    "",
    false,
    undefined,
    invoiceDatePreset
  )
  const { userInfo, isLoading: userInfoLoading } = useUserInfo()
  const { data: analytics, isLoading: analyticsLoading, error: analyticsError } = useDashboardAnalytics(
    timeRange,
    cashierFilter,
    paymentFilter
  )

  const isAdminUser = userInfo?.is_admin_user || false
  const currentUserCashier = userInfo?.full_name || "Unknown"

  const paymentOptions = useMemo(() => {
    const fromApi = (analytics?.payment_methods ?? []).map((m) => m.method)
    const base = ["Cash", "Debit Card", "Credit", "-"]
    return ["all", ...new Set([...base, ...fromApi].filter(Boolean))]
  }, [analytics?.payment_methods])

  useEffect(() => {
    if (userInfo && !isAdminUser) {
      setCashierFilter(currentUserCashier)
    }
  }, [userInfo, isAdminUser, currentUserCashier])

  useEffect(() => {
    setShowFilters(!isMobile)
  }, [isMobile])

  const filteredInvoicesForPOS = useMemo(() => {
    return invoices.filter((invoice) => isAdminUser || !posDetails?.name || invoice.posProfile === posDetails.name)
  }, [invoices, isAdminUser, posDetails?.name])

  const uniqueCashiersFiltered = useMemo(
    () =>
      [...new Set(filteredInvoicesForPOS.map((inv: SalesInvoice) => inv.cashier).filter(Boolean))] as string[],
    [filteredInvoicesForPOS]
  )

  const summary = analytics?.summary
  const currency = summary?.currency || posDetails?.currency || "USD"

  const loading = userInfoLoading || invoicesLoading || analyticsLoading

  const filterPanel = (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-6 border border-gray-200 dark:border-gray-700 mb-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Dashboard filters</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Time range</label>
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value as DashboardTimeRange)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          >
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="week">Last 7 days</option>
            <option value="month">This month</option>
            <option value="session">Current POS session</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Cashier</label>
          <select
            value={cashierFilter}
            onChange={(e) => setCashierFilter(e.target.value)}
            disabled={!isAdminUser}
            className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white ${
              !isAdminUser ? "opacity-50 cursor-not-allowed" : ""
            }`}
          >
            <option value="all">All cashiers</option>
            {uniqueCashiersFiltered.map((cashier: string) => (
              <option key={cashier} value={cashier}>
                {cashier}
              </option>
            ))}
          </select>
          {!isAdminUser && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Showing only your transactions</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Payment method</label>
          <select
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          >
            {paymentOptions.map((m) => (
              <option key={m} value={m}>
                {m === "all" ? "All methods" : m}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <button
            type="button"
            onClick={() => {
              setTimeRange("today")
              setPaymentFilter("all")
              if (isAdminUser) setCashierFilter("all")
            }}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            Reset filters
          </button>
        </div>
      </div>
    </div>
  )

  const mainContent = (
    <>
      {analyticsError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 px-4 py-3 text-sm text-red-800 dark:text-red-200">
          {analyticsError}
        </div>
      )}

      {showFilters && filterPanel}

      {summary && <KPICards summary={summary} />}
      {summary && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 max-w-4xl leading-relaxed">
          Cost per line uses the purchase price from the matching batch on a Purchase Invoice when available;
          otherwise ERPNext&apos;s valuation rate on the sale line. Margin % is (net sales − cost) ÷ net sales.
          Net sales exclude tax.
        </p>
      )}

      <div className="mt-6 space-y-6">
        {timeRange === "today" && analytics?.sales_by_hour && (
          <SalesByHourChart data={analytics.sales_by_hour} currency={currency} />
        )}

        {analytics && (
          <SalesListingTabs
            products={analytics.products}
            customers={analytics.customers}
            transactions={analytics.transactions}
            currency={currency}
            dashboardTimeRange={timeRange}
            dashboardCashierFilter={cashierFilter}
            dashboardPaymentFilter={paymentFilter}
          />
        )}

        {analytics && <CashierPerformance cashiers={analytics.cashiers} currency={currency} />}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {analytics && summary && (
            <DiscountSummary summary={summary} topItems={analytics.discount_top_items} />
          )}
          {analytics && <PaymentMethodsPanel methods={analytics.payment_methods} currency={currency} />}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {analytics && (
            <TopItemsTable
              products={analytics.products_top_alltime}
              currency={currency}
              scopeLabel="All-time"
            />
          )}
          {analytics && (
            <TopCustomersTable
              customers={analytics.customers_top_alltime}
              currency={currency}
              scopeLabel="All-time"
            />
          )}
        </div>

        {posDetails?.is_zatca_enabled && analytics?.zatca_breakdown && analytics.zatca_breakdown.length > 0 && (
          <ZatcaStatusPanel segments={analytics.zatca_breakdown} />
        )}
      </div>
    </>
  )

  if (loading && !analytics) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600 mx-auto" />
          <p className="mt-4 text-gray-600 dark:text-gray-300">Loading dashboard…</p>
        </div>
      </div>
    )
  }

  if (isMobile) {
    return (
      <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="sticky top-0 z-20 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
          <div className="pl-14 pr-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <h1 className="text-lg font-bold text-gray-900 dark:text-white">Sales dashboard</h1>
              <button
                type="button"
                onClick={() => setShowFilters((s) => !s)}
                className="flex items-center gap-2 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                <Filter className="w-4 h-4" />
                <span className="text-sm">Filters</span>
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pb-4 w-[98%] mx-auto px-2 py-4">{mainContent}</div>
        <BottomNavigation />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex pb-12">
      <div className="flex-1 flex flex-col overflow-hidden ml-20">
        <div className="fixed top-0 left-20 right-0 z-50 bg-brand-50 dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
          <div className="px-4 sm:px-6 py-4">
            <div className="flex items-center justify-between gap-4">
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">Sales dashboard</h1>
              <button
                type="button"
                onClick={() => setShowFilters((s) => !s)}
                className="flex items-center gap-2 px-3 sm:px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                <Filter className="w-4 h-4" />
                <span className="hidden sm:inline">Filters</span>
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 px-4 sm:px-6 py-8 mt-16 overflow-y-auto">{mainContent}</div>
      </div>
    </div>
  )
}
