import { useMemo, useState } from "react"
import { formatCurrency } from "../../utils/currency"
import { profitColorClass } from "../../utils/dashboardProfit"
import { useLazyScrollRows } from "../../hooks/useLazyScrollRows"
import type { DashboardCustomerRow } from "../../types/dashboardAnalytics"
import { SortableTh } from "./SortableTh"

interface CustomerSalesListingProps {
  customers: DashboardCustomerRow[]
  currency: string
}

const COL_COUNT = 7

type CustomerSortKey =
  | "customer"
  | "transaction_count"
  | "qty_bought"
  | "revenue"
  | "cost"
  | "gross_profit"
  | "margin_pct"

export function CustomerSalesListing({ customers, currency }: CustomerSalesListingProps) {
  const [sortKey, setSortKey] = useState<CustomerSortKey | null>(null)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const sortedCustomers = useMemo(() => {
    if (!sortKey) return customers
    const mult = sortDir === "asc" ? 1 : -1
    const copy = [...customers]
    const label = (c: DashboardCustomerRow) =>
      (c.customer_name || c.customer || "").toLowerCase()
    copy.sort((a, b) => {
      switch (sortKey) {
        case "customer":
          return mult * label(a).localeCompare(label(b), undefined, { sensitivity: "base" })
        case "transaction_count":
          return mult * (a.transaction_count - b.transaction_count)
        case "qty_bought":
          return mult * (a.qty_bought - b.qty_bought)
        case "revenue":
          return mult * (a.revenue - b.revenue)
        case "cost":
          return mult * (a.cost - b.cost)
        case "gross_profit":
          return mult * (a.gross_profit - b.gross_profit)
        case "margin_pct":
          return mult * (a.margin_pct - b.margin_pct)
        default:
          return 0
      }
    })
    return copy
  }, [customers, sortKey, sortDir])

  const { scrollRef, sentinelRef, visibleCount, hasMore } = useLazyScrollRows(sortedCustomers.length, {
    resetKey: `${sortKey ?? "default"}-${sortDir}`,
  })
  const visible = sortedCustomers.slice(0, visibleCount)

  const toggleSort = (key: CustomerSortKey, numberColumn: boolean) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir(numberColumn ? "desc" : "asc")
    }
  }

  const dirFor = (key: CustomerSortKey) => (sortKey === key ? sortDir : null)

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col max-h-[420px] sm:max-h-[520px]">
      <div className="p-4 sm:p-5 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Customer sales</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Net sales (excl. tax), COGS, profit, and markup % on cost by customer
        </p>
      </div>
      <div ref={scrollRef} className="overflow-auto flex-1 p-2 sm:p-4">
        {customers.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">No customers</p>
        ) : (
          <>
            <table className="min-w-full text-xs sm:text-sm">
              <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900 z-10">
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-600">
                  <SortableTh
                    sortKey="customer"
                    active={sortKey === "customer"}
                    direction={dirFor("customer")}
                    onSort={() => toggleSort("customer", false)}
                  >
                    Customer
                  </SortableTh>
                  <SortableTh
                    sortKey="transaction_count"
                    active={sortKey === "transaction_count"}
                    direction={dirFor("transaction_count")}
                    onSort={() => toggleSort("transaction_count", true)}
                    align="right"
                    className="text-right"
                  >
                    Txns
                  </SortableTh>
                  <SortableTh
                    sortKey="qty_bought"
                    active={sortKey === "qty_bought"}
                    direction={dirFor("qty_bought")}
                    onSort={() => toggleSort("qty_bought", true)}
                    align="right"
                    className="text-right hidden sm:table-cell"
                  >
                    Qty
                  </SortableTh>
                  <SortableTh
                    sortKey="revenue"
                    active={sortKey === "revenue"}
                    direction={dirFor("revenue")}
                    onSort={() => toggleSort("revenue", true)}
                    align="right"
                    className="text-right hidden sm:table-cell"
                  >
                    Revenue
                  </SortableTh>
                  <SortableTh
                    sortKey="cost"
                    active={sortKey === "cost"}
                    direction={dirFor("cost")}
                    onSort={() => toggleSort("cost", true)}
                    align="right"
                    className="text-right hidden md:table-cell"
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
                </tr>
              </thead>
              <tbody className="text-gray-900 dark:text-gray-100">
                {visible.map((c, idx) => (
                  <tr
                    key={`${c.customer}|${c.customer_name}|${idx}`}
                    className="border-b border-gray-100 dark:border-gray-700/80"
                  >
                    <td className="py-2 px-2 max-w-[180px] truncate font-medium" title={c.customer_name}>
                      {c.customer_name || c.customer || "—"}
                    </td>
                    <td className="py-2 px-2 text-right">{c.transaction_count}</td>
                    <td className="py-2 px-2 text-right hidden sm:table-cell">{c.qty_bought}</td>
                    <td className="py-2 px-2 text-right hidden sm:table-cell">
                      {formatCurrency(c.revenue, currency)}
                    </td>
                    <td className="py-2 px-2 text-right hidden md:table-cell">
                      {formatCurrency(c.cost, currency)}
                    </td>
                    <td className={`py-2 px-2 text-right font-medium ${profitColorClass(c.gross_profit)}`}>
                      {formatCurrency(c.gross_profit, currency)}
                    </td>
                    <td className="py-2 px-2 text-right">{c.margin_pct.toFixed(1)}%</td>
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
              Showing {visibleCount} of {sortedCustomers.length}
              {hasMore ? " · scroll for more" : ""}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
