import { useState } from "react"
import { CustomerSalesListing } from "./CustomerSalesListing"
import { ProductSalesListing } from "./ProductSalesListing"
import { TransactionListing } from "./TransactionListing"
import type { DashboardTimeRange } from "../../hooks/useDashboardAnalytics"
import type {
  DashboardCustomerRow,
  DashboardProductRow,
  DashboardTransactionRow,
} from "../../types/dashboardAnalytics"

type TabId = "products" | "customers" | "transactions"

interface SalesListingTabsProps {
  products: DashboardProductRow[]
  customers: DashboardCustomerRow[]
  transactions: DashboardTransactionRow[]
  currency: string
  dashboardTimeRange: DashboardTimeRange
  dashboardCashierFilter: string
  dashboardPaymentFilter: string
}

const TABS: { id: TabId; label: string }[] = [
  { id: "products", label: "Products" },
  { id: "customers", label: "Customers" },
  { id: "transactions", label: "Transactions" },
]

export function SalesListingTabs({
  products,
  customers,
  transactions,
  currency,
  dashboardTimeRange,
  dashboardCashierFilter,
  dashboardPaymentFilter,
}: SalesListingTabsProps) {
  const [tab, setTab] = useState<TabId>("products")

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Sales by dimension</h3>
        <div className="flex flex-wrap gap-2" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === t.id
                  ? "bg-brand-600 text-white"
                  : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div role="tabpanel">
        {tab === "products" && (
          <ProductSalesListing
            products={products}
            currency={currency}
            dashboardTimeRange={dashboardTimeRange}
            dashboardCashierFilter={dashboardCashierFilter}
            dashboardPaymentFilter={dashboardPaymentFilter}
          />
        )}
        {tab === "customers" && <CustomerSalesListing customers={customers} currency={currency} />}
        {tab === "transactions" && <TransactionListing transactions={transactions} currency={currency} />}
      </div>
    </div>
  )
}
