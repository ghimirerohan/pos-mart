import { UserCircle } from "lucide-react"
import { formatCurrency } from "../../utils/currency"
import { profitColorClass } from "../../utils/dashboardProfit"
import type { DashboardCashierRow } from "../../types/dashboardAnalytics"

interface CashierPerformanceProps {
  cashiers: DashboardCashierRow[]
  currency: string
}

export function CashierPerformance({ cashiers, currency }: CashierPerformanceProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="p-4 sm:p-5 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
        <UserCircle className="w-5 h-5 text-brand-600" />
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Cashier performance</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            For the selected filters and time range
          </p>
        </div>
      </div>
      <div className="overflow-x-auto p-2 sm:p-4">
        {cashiers.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">No cashier data</p>
        ) : (
          <table className="min-w-full text-xs sm:text-sm">
            <thead>
              <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-600">
                <th className="py-2 px-2">Cashier</th>
                <th className="py-2 px-2 text-right">Qty</th>
                <th className="py-2 px-2 text-right">Txns</th>
                <th className="py-2 px-2 text-right hidden sm:table-cell">Customers</th>
                <th className="py-2 px-2 text-right hidden md:table-cell">Revenue</th>
                <th className="py-2 px-2 text-right hidden lg:table-cell">Discount</th>
                <th className="py-2 px-2 text-right">Profit</th>
                <th className="py-2 px-2 text-right">Margin</th>
              </tr>
            </thead>
            <tbody className="text-gray-900 dark:text-gray-100">
              {cashiers.map((row) => (
                <tr key={row.owner} className="border-b border-gray-100 dark:border-gray-700/80">
                  <td className="py-2 px-2 font-medium max-w-[140px] truncate" title={row.cashier_name}>
                    {row.cashier_name}
                  </td>
                  <td className="py-2 px-2 text-right">{row.qty_sold}</td>
                  <td className="py-2 px-2 text-right">{row.transaction_count}</td>
                  <td className="py-2 px-2 text-right hidden sm:table-cell">{row.unique_customers}</td>
                  <td className="py-2 px-2 text-right hidden md:table-cell">
                    {formatCurrency(row.revenue, currency)}
                  </td>
                  <td className="py-2 px-2 text-right hidden lg:table-cell">
                    {formatCurrency(row.discount, currency)}
                  </td>
                  <td className={`py-2 px-2 text-right font-medium ${profitColorClass(row.gross_profit)}`}>
                    {formatCurrency(row.gross_profit, currency)}
                  </td>
                  <td className="py-2 px-2 text-right">{row.margin_pct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
