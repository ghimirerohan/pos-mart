import { BarChart3 } from "lucide-react"
import type { ZatcaBreakdownRow } from "../../types/dashboardAnalytics"

const COLOR_MAP: Record<string, string> = {
  pending: "#f59e0b",
  reported: "#3b82f6",
  "not reported": "#9ca3af",
  cleared: "#16a34a",
  "not cleared": "#ef4444",
  draft: "#6b7280",
}

interface ZatcaStatusPanelProps {
  segments: ZatcaBreakdownRow[]
}

export function ZatcaStatusPanel({ segments }: ZatcaStatusPanelProps) {
  const total = segments.reduce((a, s) => a + s.count, 0)
  if (!total) return null

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">ZATCA status</h3>
        <BarChart3 className="w-5 h-5 text-gray-400" />
      </div>

      <div className="h-48 flex items-end justify-between gap-1 sm:gap-2 mb-4">
        {segments.map((segment) => {
          const maxCount = Math.max(...segments.map((s) => s.count), 1)
          const height = maxCount > 0 ? (segment.count / maxCount) * 180 : 4
          const color = COLOR_MAP[segment.status.toLowerCase()] || "#9ca3af"
          return (
            <div key={segment.status} className="flex flex-col items-center flex-1 min-w-0 group">
              <div className="relative w-full flex flex-col justify-end h-[180px]">
                <div
                  className="w-full rounded-t hover:opacity-90 transition-opacity cursor-default"
                  style={{ height: `${Math.max(height, 4)}px`, backgroundColor: color }}
                  title={`${segment.status}: ${segment.count}`}
                />
              </div>
              <span className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400 mt-2 text-center leading-tight line-clamp-2">
                {segment.status}
              </span>
            </div>
          )
        })}
      </div>

      <ul className="space-y-2 text-sm">
        {segments.map((segment) => {
          const color = COLOR_MAP[segment.status.toLowerCase()] || "#9ca3af"
          return (
            <li key={segment.status} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 min-w-0">
                <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: color }} />
                <span className="text-gray-700 dark:text-gray-300 truncate">{segment.status}</span>
              </span>
              <span className="text-gray-600 dark:text-gray-400 shrink-0">
                {segment.count} ({Math.round(segment.percentage)}%)
              </span>
            </li>
          )
        })}
      </ul>
      <p className="text-center text-sm text-gray-600 dark:text-gray-400 mt-4 pt-3 border-t border-gray-200 dark:border-gray-600">
        Total invoices: <span className="font-semibold text-brand-600 dark:text-brand-400">{total}</span>
      </p>
    </div>
  )
}
