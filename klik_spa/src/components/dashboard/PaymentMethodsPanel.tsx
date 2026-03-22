import { PieChart } from "lucide-react"
import { formatCurrency } from "../../utils/currency"
import type { PaymentMethodRow } from "../../types/dashboardAnalytics"

const COLORS = ["bg-orange-500", "bg-blue-600", "bg-emerald-500", "bg-violet-500", "bg-pink-500", "bg-cyan-500"]

interface PaymentMethodsPanelProps {
  methods: PaymentMethodRow[]
  currency: string
}

export function PaymentMethodsPanel({ methods, currency }: PaymentMethodsPanelProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Payment methods</h3>
        <PieChart className="w-5 h-5 text-gray-400" />
      </div>

      {methods.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-8">No payment data</p>
      ) : (
        <>
          <div className="space-y-3">
            {methods.map((m, i) => (
              <div
                key={m.method}
                className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/80 rounded-lg"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-3 h-3 rounded shrink-0 ${COLORS[i % COLORS.length]}`} />
                  <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{m.method}</span>
                </div>
                <div className="text-right shrink-0 ml-2">
                  <div className="font-semibold text-gray-900 dark:text-white">
                    {formatCurrency(m.amount, currency)}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {m.percentage.toFixed(1)}% · {m.transactions} txns
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex rounded-lg overflow-hidden h-3">
            {methods.map((m, i) => (
              <div
                key={m.method}
                className={COLORS[i % COLORS.length]}
                style={{ width: `${Math.max(m.percentage, 0)}%` }}
                title={m.method}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
