import { useMemo, useState } from "react"
import { formatCurrency } from "../../utils/currency"
import { profitColorClass } from "../../utils/dashboardProfit"
import { useLazyScrollRows } from "../../hooks/useLazyScrollRows"
import type { DashboardTransactionRow } from "../../types/dashboardAnalytics"
import { SortableTh } from "./SortableTh"

interface TransactionListingProps {
  transactions: DashboardTransactionRow[]
  currency: string
}

const COL_COUNT = 8

type TransactionSortKey =
  | "name"
  | "customer_name"
  | "posting_datetime"
  | "revenue"
  | "cost"
  | "gross_profit"
  | "margin_pct"
  | "discount_amount"

function datetimeSortValue(t: DashboardTransactionRow): string {
  const time = (t.posting_time || "").slice(0, 8)
  return `${t.posting_date} ${time}`
}

export function TransactionListing({ transactions, currency }: TransactionListingProps) {
  const [sortKey, setSortKey] = useState<TransactionSortKey | null>(null)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const sortedTransactions = useMemo(() => {
    if (!sortKey) return transactions
    const mult = sortDir === "asc" ? 1 : -1
    const copy = [...transactions]
    copy.sort((a, b) => {
      switch (sortKey) {
        case "name":
          return mult * a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
        case "customer_name":
          return mult * (a.customer_name || "").localeCompare(b.customer_name || "", undefined, {
            sensitivity: "base",
          })
        case "posting_datetime":
          return mult * datetimeSortValue(a).localeCompare(datetimeSortValue(b))
        case "revenue":
          return mult * (a.revenue - b.revenue)
        case "cost":
          return mult * (a.cost - b.cost)
        case "gross_profit":
          return mult * (a.gross_profit - b.gross_profit)
        case "margin_pct":
          return mult * (a.margin_pct - b.margin_pct)
        case "discount_amount":
          return mult * (a.discount_amount - b.discount_amount)
        default:
          return 0
      }
    })
    return copy
  }, [transactions, sortKey, sortDir])

  const { scrollRef, sentinelRef, visibleCount, hasMore } = useLazyScrollRows(sortedTransactions.length, {
    resetKey: `${sortKey ?? "default"}-${sortDir}`,
  })
  const visible = sortedTransactions.slice(0, visibleCount)

  const toggleSort = (key: TransactionSortKey, numberColumn: boolean) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir(numberColumn ? "desc" : "asc")
    }
  }

  const dirFor = (key: TransactionSortKey) => (sortKey === key ? sortDir : null)

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col max-h-[480px] sm:max-h-[600px]">
      <div className="p-4 sm:p-5 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Transactions</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Per-invoice net sales (excl. tax), COGS, profit, markup % on cost, and bill discount
        </p>
      </div>
      <div ref={scrollRef} className="overflow-auto flex-1 p-2 sm:p-4">
        {transactions.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">No transactions</p>
        ) : (
          <>
            <table className="min-w-full text-xs sm:text-sm">
              <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900 z-10">
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-600">
                  <SortableTh
                    sortKey="name"
                    active={sortKey === "name"}
                    direction={dirFor("name")}
                    onSort={() => toggleSort("name", false)}
                  >
                    Invoice
                  </SortableTh>
                  <SortableTh
                    sortKey="customer_name"
                    active={sortKey === "customer_name"}
                    direction={dirFor("customer_name")}
                    onSort={() => toggleSort("customer_name", false)}
                    className="hidden sm:table-cell"
                  >
                    Customer
                  </SortableTh>
                  <SortableTh
                    sortKey="posting_datetime"
                    active={sortKey === "posting_datetime"}
                    direction={dirFor("posting_datetime")}
                    onSort={() => toggleSort("posting_datetime", false)}
                    className="hidden md:table-cell"
                  >
                    Date
                  </SortableTh>
                  <SortableTh
                    sortKey="revenue"
                    active={sortKey === "revenue"}
                    direction={dirFor("revenue")}
                    onSort={() => toggleSort("revenue", true)}
                    align="right"
                    className="text-right"
                  >
                    Revenue
                  </SortableTh>
                  <SortableTh
                    sortKey="cost"
                    active={sortKey === "cost"}
                    direction={dirFor("cost")}
                    onSort={() => toggleSort("cost", true)}
                    align="right"
                    className="text-right hidden lg:table-cell"
                  >
                    Cost
                  </SortableTh>
                  <SortableTh
                    sortKey="gross_profit"
                    active={sortKey === "gross_profit"}
                    direction={dirFor("gross_profit")}
                    onSort={() => toggleSort("gross_profit", true)}
                    align="right"
                    className="text-right"
                  >
                    Profit
                  </SortableTh>
                  <SortableTh
                    sortKey="margin_pct"
                    active={sortKey === "margin_pct"}
                    direction={dirFor("margin_pct")}
                    onSort={() => toggleSort("margin_pct", true)}
                    align="right"
                    className="text-right"
                    title="(revenue − cost) ÷ revenue"
                  >
                    Margin %
                  </SortableTh>
                  <SortableTh
                    sortKey="discount_amount"
                    active={sortKey === "discount_amount"}
                    direction={dirFor("discount_amount")}
                    onSort={() => toggleSort("discount_amount", true)}
                    align="right"
                    className="text-right hidden sm:table-cell"
                  >
                    Discount
                  </SortableTh>
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
              Showing {visibleCount} of {sortedTransactions.length}
              {hasMore ? " · scroll for more" : ""}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
