import { useMemo, useState } from "react"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Package } from "lucide-react"
import { formatCurrency } from "../../utils/currency"
import { profitColorClass } from "../../utils/dashboardProfit"
import type { DashboardProductRow } from "../../types/dashboardAnalytics"

export type ItemSortKey = "qty_sold" | "revenue" | "gross_profit" | "margin_pct"

interface TopItemsTableProps {
  /** Full product list; top 10 by selected metric are shown */
  products: DashboardProductRow[]
  currency: string
}

const SORT_OPTIONS: { value: ItemSortKey; label: string }[] = [
  { value: "qty_sold", label: "Qty sold" },
  { value: "revenue", label: "Revenue" },
  { value: "gross_profit", label: "Profit" },
  { value: "margin_pct", label: "Margin %" },
]

export function TopItemsTable({ products, currency }: TopItemsTableProps) {
  const [sortBy, setSortBy] = useState<ItemSortKey>("revenue")

  const top10 = useMemo(() => {
    const copy = [...products]
    copy.sort((a, b) => (b[sortBy] as number) - (a[sortBy] as number))
    return copy.slice(0, 10)
  }, [products, sortBy])

  const barData = useMemo(
    () =>
      top10.map((p) => ({
        key: p.item_code,
        name:
          (p.item_name || p.item_code).slice(0, 12) +
          ((p.item_name || p.item_code).length > 12 ? "…" : ""),
        value: p[sortBy] as number,
      })),
    [top10, sortBy]
  )

  const barName =
    sortBy === "qty_sold"
      ? "Qty"
      : sortBy === "revenue"
        ? "Revenue"
        : sortBy === "gross_profit"
          ? "Profit"
          : "Margin %"

  const formatBarTooltip = (v: number) => {
    if (sortBy === "margin_pct") return `${v.toFixed(1)}%`
    if (sortBy === "qty_sold") return String(v)
    return formatCurrency(v, currency)
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="p-4 sm:p-5 border-b border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <Package className="w-5 h-5 text-brand-600 shrink-0" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Top 10 items</h3>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label htmlFor="top-items-sort" className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
            Rank by
          </label>
          <select
            id="top-items-sort"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as ItemSortKey)}
            className="text-sm px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        {top10.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">No product data</p>
        ) : (
          <>
            <div className="w-full h-[200px] mb-6">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.15} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10 }} stroke="#9ca3af" />
                  <YAxis type="category" dataKey="name" width={88} tick={{ fontSize: 9 }} stroke="#9ca3af" />
                  <Tooltip
                    formatter={(v: number) => formatBarTooltip(v)}
                    contentStyle={{ borderRadius: 8 }}
                  />
                  <Bar dataKey="value" fill="#ea580c" radius={[0, 4, 4, 0]} name={barName} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-600">
                    <th className="pb-2 pr-2">#</th>
                    <th className="pb-2 pr-2">Item</th>
                    <th className="pb-2 pr-2 text-right">Qty</th>
                    <th className="pb-2 pr-2 text-right hidden sm:table-cell">Revenue</th>
                    <th className="pb-2 pr-2 text-right hidden md:table-cell">Profit</th>
                    <th className="pb-2 text-right">Margin</th>
                  </tr>
                </thead>
                <tbody className="text-gray-900 dark:text-gray-100">
                  {top10.map((p, i) => (
                    <tr key={p.item_code || i} className="border-b border-gray-100 dark:border-gray-700/80">
                      <td className="py-2 pr-2 font-medium text-brand-600">{i + 1}</td>
                      <td className="py-2 pr-2 max-w-[140px] truncate" title={p.item_name}>
                        {p.item_name || p.item_code}
                      </td>
                      <td className="py-2 pr-2 text-right">{p.qty_sold}</td>
                      <td className="py-2 pr-2 text-right hidden sm:table-cell">
                        {formatCurrency(p.revenue, currency)}
                      </td>
                      <td className={`py-2 pr-2 text-right hidden md:table-cell ${profitColorClass(p.gross_profit)}`}>
                        {formatCurrency(p.gross_profit, currency)}
                      </td>
                      <td className="py-2 text-right">{p.margin_pct.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
