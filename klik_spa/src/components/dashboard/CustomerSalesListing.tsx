import { formatCurrency } from "../../utils/currency"
import { profitColorClass } from "../../utils/dashboardProfit"
import { useLazyScrollRows } from "../../hooks/useLazyScrollRows"
import type { DashboardCustomerRow } from "../../types/dashboardAnalytics"

interface CustomerSalesListingProps {
  customers: DashboardCustomerRow[]
  currency: string
}

const COL_COUNT = 7

export function CustomerSalesListing({ customers, currency }: CustomerSalesListingProps) {
  const { scrollRef, sentinelRef, visibleCount, hasMore } = useLazyScrollRows(customers.length)
  const visible = customers.slice(0, visibleCount)

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col max-h-[420px] sm:max-h-[520px]">
      <div className="p-4 sm:p-5 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Customer sales</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Revenue, cost, and margin by customer</p>
      </div>
      <div ref={scrollRef} className="overflow-auto flex-1 p-2 sm:p-4">
        {customers.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">No customers</p>
        ) : (
          <>
            <table className="min-w-full text-xs sm:text-sm">
              <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900 z-10">
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-600">
                  <th className="py-2 px-2">Customer</th>
                  <th className="py-2 px-2 text-right">Txns</th>
                  <th className="py-2 px-2 text-right hidden sm:table-cell">Qty</th>
                  <th className="py-2 px-2 text-right hidden sm:table-cell">Revenue</th>
                  <th className="py-2 px-2 text-right hidden md:table-cell">Cost</th>
                  <th className="py-2 px-2 text-right">Profit</th>
                  <th className="py-2 px-2 text-right">Margin</th>
                </tr>
              </thead>
              <tbody className="text-gray-900 dark:text-gray-100">
                {visible.map((c, idx) => (
                  <tr
                    key={`${c.customer}|${c.customer_name}|${idx}`}
                    className="border-b border-gray-100 dark:border-gray-700/80"
                  >
                    <td className="py-2 px-2 max-w-[180px] truncate font-medium" title={c.customer_name}>
                      {c.customer_name || c.customer || "—"}
                    </td>
                    <td className="py-2 px-2 text-right">{c.transaction_count}</td>
                    <td className="py-2 px-2 text-right hidden sm:table-cell">{c.qty_bought}</td>
                    <td className="py-2 px-2 text-right hidden sm:table-cell">
                      {formatCurrency(c.revenue, currency)}
                    </td>
                    <td className="py-2 px-2 text-right hidden md:table-cell">
                      {formatCurrency(c.cost, currency)}
                    </td>
                    <td className={`py-2 px-2 text-right font-medium ${profitColorClass(c.gross_profit)}`}>
                      {formatCurrency(c.gross_profit, currency)}
                    </td>
                    <td className="py-2 px-2 text-right">{c.margin_pct.toFixed(1)}%</td>
                  </tr>
                ))}
                {hasMore && (
                  <tr aria-hidden className="border-0">
                    <td colSpan={COL_COUNT} className="p-0 border-0">
                      <div ref={sentinelRef} className="h-4 w-full" />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <p className="text-center text-[11px] text-gray-500 dark:text-gray-400 py-2">
              Showing {visibleCount} of {customers.length}
              {hasMore ? " · scroll for more" : ""}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
