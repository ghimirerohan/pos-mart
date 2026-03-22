import { formatCurrency } from "../../utils/currency"
import { profitColorClass } from "../../utils/dashboardProfit"
import { useLazyScrollRows } from "../../hooks/useLazyScrollRows"
import type { DashboardProductRow } from "../../types/dashboardAnalytics"

interface ProductSalesListingProps {
  products: DashboardProductRow[]
  currency: string
}

const COL_COUNT = 7

export function ProductSalesListing({ products, currency }: ProductSalesListingProps) {
  const { scrollRef, sentinelRef, visibleCount, hasMore } = useLazyScrollRows(products.length)
  const visible = products.slice(0, visibleCount)

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col max-h-[420px] sm:max-h-[520px]">
      <div className="p-4 sm:p-5 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Product sales</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">All items with margin and profit</p>
      </div>
      <div ref={scrollRef} className="overflow-auto flex-1 p-2 sm:p-4">
        {products.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">No products</p>
        ) : (
          <>
            <table className="min-w-full text-xs sm:text-sm">
              <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900 z-10">
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-600">
                  <th className="py-2 px-2">Item</th>
                  <th className="py-2 px-2 text-right">Qty</th>
                  <th className="py-2 px-2 text-right hidden sm:table-cell">Revenue</th>
                  <th className="py-2 px-2 text-right hidden md:table-cell">Cost</th>
                  <th className="py-2 px-2 text-right">Profit</th>
                  <th className="py-2 px-2 text-right">Margin</th>
                  <th className="py-2 px-2 text-right hidden lg:table-cell">Discount</th>
                </tr>
              </thead>
              <tbody className="text-gray-900 dark:text-gray-100">
                {visible.map((p) => (
                  <tr key={p.item_code} className="border-b border-gray-100 dark:border-gray-700/80">
                    <td className="py-2 px-2 max-w-[160px]">
                      <div className="font-medium truncate" title={p.item_name}>
                        {p.item_name || p.item_code}
                      </div>
                      <div className="text-gray-500 text-[10px] sm:text-xs truncate">{p.item_code}</div>
                    </td>
                    <td className="py-2 px-2 text-right">{p.qty_sold}</td>
                    <td className="py-2 px-2 text-right hidden sm:table-cell">
                      {formatCurrency(p.revenue, currency)}
                    </td>
                    <td className="py-2 px-2 text-right hidden md:table-cell">
                      {formatCurrency(p.cost, currency)}
                    </td>
                    <td className={`py-2 px-2 text-right font-medium ${profitColorClass(p.gross_profit)}`}>
                      {formatCurrency(p.gross_profit, currency)}
                    </td>
                    <td className="py-2 px-2 text-right">{p.margin_pct.toFixed(1)}%</td>
                    <td className="py-2 px-2 text-right hidden lg:table-cell">
                      {formatCurrency(p.discount, currency)}
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
              Showing {visibleCount} of {products.length}
              {hasMore ? " · scroll for more" : ""}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
