import { DollarSign, Percent, ShoppingCart, Tag, TrendingUp, Wallet } from "lucide-react"
import { formatCurrency } from "../../utils/currency"
import { profitColorClass } from "../../utils/dashboardProfit"
import type { DashboardSummary } from "../../types/dashboardAnalytics"

interface KPICardsProps {
  summary: DashboardSummary
}

export function KPICards({ summary }: KPICardsProps) {
  const c = summary.currency || "USD"

  const cards = [
    {
      label: "Total revenue",
      value: formatCurrency(summary.total_revenue, c),
      valueClass: "text-gray-900 dark:text-white",
      icon: DollarSign,
      iconBg: "bg-orange-100 dark:bg-orange-900/30",
      iconColor: "text-orange-600 dark:text-orange-400",
    },
    {
      label: "Gross profit",
      value: formatCurrency(summary.gross_profit, c),
      valueClass: profitColorClass(summary.gross_profit),
      icon: Wallet,
      iconBg: "bg-emerald-100 dark:bg-emerald-900/30",
      iconColor: "text-emerald-600 dark:text-emerald-400",
    },
    {
      label: "Gross margin",
      value: `${summary.gross_margin_pct.toFixed(1)}%`,
      valueClass: "text-gray-900 dark:text-white",
      icon: Percent,
      iconBg: "bg-violet-100 dark:bg-violet-900/30",
      iconColor: "text-violet-600 dark:text-violet-400",
    },
    {
      label: "Transactions",
      value: String(summary.total_transactions),
      valueClass: "text-gray-900 dark:text-white",
      icon: ShoppingCart,
      iconBg: "bg-blue-100 dark:bg-blue-900/30",
      iconColor: "text-blue-600 dark:text-blue-400",
    },
    {
      label: "Items sold",
      value: String(Math.round(summary.total_items_sold)),
      valueClass: "text-gray-900 dark:text-white",
      icon: TrendingUp,
      iconBg: "bg-amber-100 dark:bg-amber-900/30",
      iconColor: "text-amber-600 dark:text-amber-400",
    },
    {
      label: "Total discounts",
      value: formatCurrency(summary.total_discounts, c),
      valueClass: "text-gray-900 dark:text-white",
      icon: Tag,
      iconBg: "bg-rose-100 dark:bg-rose-900/30",
      iconColor: "text-rose-600 dark:text-rose-400",
    },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 hover:shadow-md transition-shadow"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 truncate">{card.label}</p>
              <p className={`text-lg sm:text-xl font-bold mt-1 break-words ${card.valueClass}`}>{card.value}</p>
            </div>
            <div
              className={`shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${card.iconBg}`}
            >
              <card.icon className={`w-5 h-5 ${card.iconColor}`} />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
