import { formatCurrency } from "../../utils/currency"
import { profitColorClass } from "../../utils/dashboardProfit"
import { useLazyScrollRows } from "../../hooks/useLazyScrollRows"
import type { DashboardTransactionRow } from "../../types/dashboardAnalytics"

interface TransactionListingProps {
  transactions: DashboardTransactionRow[]
  currency: string
}

const COL_COUNT = 8

export function TransactionListing({ transactions, currency }: TransactionListingProps) {
  const { scrollRef, sentinelRef, visibleCount, hasMore } = useLazyScrollRows(transactions.length)
  const visible = transactions.slice(0, visibleCount)

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col max-h-[480px] sm:max-h-[600px]">
      <div className="p-4 sm:p-5 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Transactions</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Per-invoice revenue, cost, profit, and discount</p>
      </div>
      <div ref={scrollRef} className="overflow-auto flex-1 p-2 sm:p-4">
        {transactions.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">No transactions</p>
        ) : (
          <>
            <table className="min-w-full text-xs sm:text-sm">
              <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900 z-10">
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-600">
                  <th className="py-2 px-2">Invoice</th>
                  <th className="py-2 px-2 hidden sm:table-cell">Customer</th>
                  <th className="py-2 px-2 hidden md:table-cell">Date</th>
                  <th className="py-2 px-2 text-right">Revenue</th>
                  <th className="py-2 px-2 text-right hidden lg:table-cell">Cost</th>
                  <th className="py-2 px-2 text-right">Profit</th>
                  <th className="py-2 px-2 text-right">Margin</th>
                  <th className="py-2 px-2 text-right hidden sm:table-cell">Discount</th>
                </tr>
              </thead>
              <tbody className="text-gray-900 dark:text-gray-100">
                {visible.map((t) => (
                  <tr key={t.name} className="border-b border-gray-100 dark:border-gray-700/80">
                    <td className="py-2 px-2 font-mono text-[11px] sm:text-sm whitespace-nowrap">{t.name}</td>
                    <td className="py-2 px-2 hidden sm:table-cell max-w-[120px] truncate" title={t.customer_name}>
                      {t.customer_name || "—"}
                    </td>
                    <td className="py-2 px-2 hidden md:table-cell whitespace-nowrap text-gray-600 dark:text-gray-400">
                      {t.posting_date} {t.posting_time?.slice(0, 5)}
                    </td>
                    <td className="py-2 px-2 text-right">{formatCurrency(t.revenue, currency)}</td>
                    <td className="py-2 px-2 text-right hidden lg:table-cell">
                      {formatCurrency(t.cost, currency)}
                    </td>
                    <td className={`py-2 px-2 text-right font-medium ${profitColorClass(t.gross_profit)}`}>
                      {formatCurrency(t.gross_profit, currency)}
                    </td>
                    <td className="py-2 px-2 text-right">{t.margin_pct.toFixed(1)}%</td>
                    <td className="py-2 px-2 text-right hidden sm:table-cell">
                      {formatCurrency(t.discount_amount, currency)}
                    </td>
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
              Showing {visibleCount} of {transactions.length}
              {hasMore ? " · scroll for more" : ""}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
