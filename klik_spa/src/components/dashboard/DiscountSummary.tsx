import { Percent, Tag } from "lucide-react"
import { formatCurrency } from "../../utils/currency"
import type { DashboardSummary, DiscountTopItem } from "../../types/dashboardAnalytics"

interface DiscountSummaryProps {
  summary: DashboardSummary
  topItems: DiscountTopItem[]
}

export function DiscountSummary({ summary, topItems }: DiscountSummaryProps) {
  const c = summary.currency || "USD"
  const pctOfRev =
    summary.total_revenue > 0 ? (summary.total_discounts / summary.total_revenue) * 100 : 0

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Discounts</h3>
        <Percent className="w-5 h-5 text-amber-600" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 p-3 border border-amber-100 dark:border-amber-800/40">
          <p className="text-xs text-gray-600 dark:text-gray-400">Bill-level (invoice)</p>
          <p className="text-lg font-bold text-gray-900 dark:text-white">
            {formatCurrency(summary.total_bill_discount, c)}
          </p>
        </div>
        <div className="rounded-lg bg-orange-50 dark:bg-orange-900/20 p-3 border border-orange-100 dark:border-orange-800/40">
          <p className="text-xs text-gray-600 dark:text-gray-400">Line-level (items)</p>
          <p className="text-lg font-bold text-gray-900 dark:text-white">
            {formatCurrency(summary.total_line_discount, c)}
          </p>
        </div>
      </div>

      <div className="space-y-2 text-sm border-t border-gray-200 dark:border-gray-600 pt-4">
        <div className="flex justify-between">
          <span className="text-gray-600 dark:text-gray-400">Total discounts</span>
          <span className="font-semibold text-gray-900 dark:text-white">
            {formatCurrency(summary.total_discounts, c)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600 dark:text-gray-400">% of net sales</span>
          <span className="font-semibold text-amber-600 dark:text-amber-400">{pctOfRev.toFixed(1)}%</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600 dark:text-gray-400">Invoices with bill discount</span>
          <span className="font-semibold">{summary.discount_invoice_count}</span>
        </div>
      </div>

      {topItems.length > 0 && (
        <div className="mt-5 pt-4 border-t border-gray-200 dark:border-gray-600">
          <div className="flex items-center gap-2 mb-2">
            <Tag className="w-4 h-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Top discounted items (line)</span>
          </div>
          <ul className="space-y-2">
            {topItems.slice(0, 5).map((it) => (
              <li key={it.item_code} className="flex justify-between text-xs sm:text-sm">
                <span className="truncate pr-2 text-gray-700 dark:text-gray-300">{it.item_name}</span>
                <span className="shrink-0 font-medium">{formatCurrency(it.discount, c)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
