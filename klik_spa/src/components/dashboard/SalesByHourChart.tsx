import { useMemo, useState } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { Clock } from "lucide-react"
import { formatCurrency } from "../../utils/currency"
import type { SalesByHourPoint } from "../../types/dashboardAnalytics"

interface SalesByHourChartProps {
  data: SalesByHourPoint[]
  currency: string
}

export function SalesByHourChart({ data, currency }: SalesByHourChartProps) {
  const [mode, setMode] = useState<"bar" | "line">("bar")

  const chartData = useMemo(() => {
    const filtered = data.filter((d) => d.revenue > 0 || d.profit > 0)
    if (filtered.length > 0) return filtered
    return data
  }, [data])

  const peak = useMemo(() => {
    if (!chartData.length) return null
    return chartData.reduce((a, b) => (b.revenue > a.revenue ? b : a), chartData[0])
  }, [chartData])

  const totalRev = chartData.reduce((s, d) => s + d.revenue, 0)

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 sm:p-6 border border-gray-200 dark:border-gray-700">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Sales by hour</h3>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600">
            <button
              type="button"
              onClick={() => setMode("bar")}
              className={`px-3 py-1.5 text-xs font-medium ${
                mode === "bar"
                  ? "bg-brand-600 text-white"
                  : "bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
              }`}
            >
              Bar
            </button>
            <button
              type="button"
              onClick={() => setMode("line")}
              className={`px-3 py-1.5 text-xs font-medium ${
                mode === "line"
                  ? "bg-brand-600 text-white"
                  : "bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
              }`}
            >
              Line
            </button>
          </div>
          {peak && (
            <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
              <Clock className="w-4 h-4" />
              <span>
                Peak: {peak.hour} ({formatCurrency(peak.revenue, currency)})
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="w-full h-[240px] sm:h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          {mode === "bar" ? (
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} />
              <XAxis dataKey="hour" tick={{ fontSize: 10 }} stroke="#9ca3af" />
              <YAxis tick={{ fontSize: 10 }} stroke="#9ca3af" width={48} />
              <Tooltip
                formatter={(value: number, name: string) => [
                  formatCurrency(value, currency),
                  name === "revenue" ? "Revenue" : "Profit",
                ]}
                contentStyle={{
                  borderRadius: "8px",
                  border: "1px solid #e5e7eb",
                  backgroundColor: "rgba(255,255,255,0.95)",
                }}
              />
              <Legend />
              <Bar dataKey="revenue" name="Revenue" fill="#ea580c" radius={[4, 4, 0, 0]} />
              <Bar dataKey="profit" name="Gross profit" fill="#059669" radius={[4, 4, 0, 0]} />
            </BarChart>
          ) : (
            <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} />
              <XAxis dataKey="hour" tick={{ fontSize: 10 }} stroke="#9ca3af" />
              <YAxis tick={{ fontSize: 10 }} stroke="#9ca3af" width={48} />
              <Tooltip
                formatter={(value: number, name: string) => [
                  formatCurrency(value, currency),
                  name === "revenue" ? "Revenue" : "Gross profit",
                ]}
                contentStyle={{
                  borderRadius: "8px",
                  border: "1px solid #e5e7eb",
                  backgroundColor: "rgba(255,255,255,0.95)",
                }}
              />
              <Legend />
              <Line type="monotone" dataKey="revenue" name="Revenue" stroke="#ea580c" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="profit" name="Gross profit" stroke="#059669" strokeWidth={2} dot={false} />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>

      <p className="text-center text-sm text-gray-600 dark:text-gray-400 mt-2">
        Hourly total revenue:{" "}
        <span className="font-semibold text-brand-600 dark:text-brand-400">
          {formatCurrency(totalRev, currency)}
        </span>
      </p>
    </div>
  )
}
