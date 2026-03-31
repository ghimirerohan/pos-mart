import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { FileText, Loader2, X } from "lucide-react"
import { formatCurrency } from "../../utils/currency"
import { profitColorClass } from "../../utils/dashboardProfit"
import type { DashboardTimeRange } from "../../hooks/useDashboardAnalytics"
import { useLazyScrollRows } from "../../hooks/useLazyScrollRows"
import type { DashboardProductRow, ProductInvoiceDrilldownRow } from "../../types/dashboardAnalytics"
import { SortableTh } from "./SortableTh"

interface ProductSalesListingProps {
  products: DashboardProductRow[]
  currency: string
  dashboardTimeRange: DashboardTimeRange
  dashboardCashierFilter: string
  dashboardPaymentFilter: string
}

const COL_COUNT = 8

type ProductSortKey =
  | "item"
  | "qty_sold"
  | "revenue"
  | "cost"
  | "gross_profit"
  | "margin_pct"
  | "discount"

async function fetchProductInvoiceDrilldown(
  itemCode: string,
  timeRange: DashboardTimeRange,
  cashier: string,
  payment: string
): Promise<{ currency: string; rows: ProductInvoiceDrilldownRow[] }> {
  const params = new URLSearchParams()
  params.set("item_code", itemCode)
  params.set("time_range", timeRange)
  if (cashier && cashier !== "all") params.set("cashier_name", cashier)
  if (payment && payment !== "all") params.set("payment_method", payment)
  const res = await fetch(
    `/api/method/klik_pos.api.sales_invoice.get_dashboard_product_invoice_drilldown?${params.toString()}`,
    { method: "GET", headers: { Accept: "application/json" }, credentials: "include" }
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  const message = json.message
  if (!message?.success) throw new Error(message?.error || json.exc || "Failed to load lines")
  return {
    currency: message.currency || "USD",
    rows: (message.rows || []) as ProductInvoiceDrilldownRow[],
  }
}

export function ProductSalesListing({
  products,
  currency,
  dashboardTimeRange,
  dashboardCashierFilter,
  dashboardPaymentFilter,
}: ProductSalesListingProps) {
  const [sortKey, setSortKey] = useState<ProductSortKey | null>(null)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const [modalOpen, setModalOpen] = useState(false)
  const [modalTitle, setModalTitle] = useState("")
  const [modalItemCode, setModalItemCode] = useState<string | null>(null)
  const [drilldownLoading, setDrilldownLoading] = useState(false)
  const [drilldownError, setDrilldownError] = useState<string | null>(null)
  const [drilldownRows, setDrilldownRows] = useState<ProductInvoiceDrilldownRow[]>([])
  const [drilldownCurrency, setDrilldownCurrency] = useState(currency)

  const sortedProducts = useMemo(() => {
    if (!sortKey) return products
    const mult = sortDir === "asc" ? 1 : -1
    const copy = [...products]
    const label = (p: DashboardProductRow) => (p.item_name || p.item_code || "").toLowerCase()
    copy.sort((a, b) => {
      switch (sortKey) {
        case "item":
          return mult * label(a).localeCompare(label(b), undefined, { sensitivity: "base" })
        case "qty_sold":
          return mult * (a.qty_sold - b.qty_sold)
        case "revenue":
          return mult * (a.revenue - b.revenue)
        case "cost":
          return mult * (a.cost - b.cost)
        case "gross_profit":
          return mult * (a.gross_profit - b.gross_profit)
        case "margin_pct":
          return mult * (a.margin_pct - b.margin_pct)
        case "discount":
          return mult * (a.discount - b.discount)
        default:
          return 0
      }
    })
    return copy
  }, [products, sortKey, sortDir])

  const { scrollRef, sentinelRef, visibleCount, hasMore } = useLazyScrollRows(sortedProducts.length, {
    resetKey: `${sortKey ?? "default"}-${sortDir}`,
  })
  const visible = sortedProducts.slice(0, visibleCount)

  const toggleSort = (key: ProductSortKey, numberColumn: boolean) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir(numberColumn ? "desc" : "asc")
    }
  }

  const dirFor = (key: ProductSortKey) => (sortKey === key ? sortDir : null)

  const openDrilldown = useCallback(
    async (p: DashboardProductRow) => {
      setModalTitle(p.item_name || p.item_code)
      setModalItemCode(p.item_code)
      setModalOpen(true)
      setDrilldownLoading(true)
      setDrilldownError(null)
      setDrilldownRows([])
      try {
        const { currency: c, rows } = await fetchProductInvoiceDrilldown(
          p.item_code,
          dashboardTimeRange,
          dashboardCashierFilter,
          dashboardPaymentFilter
        )
        setDrilldownCurrency(c)
        setDrilldownRows(rows)
      } catch (e) {
        setDrilldownError(e instanceof Error ? e.message : "Failed to load")
      } finally {
        setDrilldownLoading(false)
      }
    },
    [dashboardTimeRange, dashboardCashierFilter, dashboardPaymentFilter]
  )

  const closeModal = useCallback(() => {
    setModalOpen(false)
    setModalItemCode(null)
    setDrilldownRows([])
    setDrilldownError(null)
  }, [])

  useEffect(() => {
    if (!modalOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [modalOpen, closeModal])

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col max-h-[420px] sm:max-h-[520px]">
      <div className="p-4 sm:p-5 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Product sales</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Net revenue (excl. tax), COGS (PI rate for batch when on file, else active buying price like Items list,
          else stock incoming rate), profit, and margin % on sales
        </p>
      </div>
      <div ref={scrollRef} className="overflow-auto flex-1 p-2 sm:p-4">
        {products.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">No products</p>
        ) : (
          <>
            <table className="min-w-full text-xs sm:text-sm">
              <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900 z-10">
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-600">
                  <SortableTh
                    sortKey="item"
                    active={sortKey === "item"}
                    direction={dirFor("item")}
                    onSort={() => toggleSort("item", false)}
                  >
                    Item
                  </SortableTh>
                  <SortableTh
                    sortKey="qty_sold"
                    active={sortKey === "qty_sold"}
                    direction={dirFor("qty_sold")}
                    onSort={() => toggleSort("qty_sold", true)}
                    align="right"
                    className="text-right"
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
                  <SortableTh
                    sortKey="discount"
                    active={sortKey === "discount"}
                    direction={dirFor("discount")}
                    onSort={() => toggleSort("discount", true)}
                    align="right"
                    className="text-right hidden lg:table-cell"
                  >
                    Discount
                  </SortableTh>
                  <th
                    scope="col"
                    className="py-2 px-1 text-right text-gray-500 dark:text-gray-400 w-14 sm:w-[4.5rem] shrink-0"
                  >
                    Lines
                  </th>
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
                    <td className="py-2 px-1 text-right align-middle">
                      <button
                        type="button"
                        onClick={() => openDrilldown(p)}
                        className="inline-flex items-center justify-center rounded-lg p-1.5 text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-950/40"
                        title="Show invoices for this item"
                        aria-label={`Invoice lines for ${p.item_name || p.item_code}`}
                      >
                        <FileText className="w-4 h-4 sm:w-[18px] sm:h-[18px]" />
                      </button>
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
              Showing {visibleCount} of {sortedProducts.length}
              {hasMore ? " · scroll for more" : ""}
            </p>
          </>
        )}
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="product-drilldown-title"
          onClick={closeModal}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-t-xl sm:rounded-xl border border-gray-200 dark:border-gray-700 shadow-xl w-full sm:max-w-4xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2 p-4 border-b border-gray-200 dark:border-gray-600 shrink-0">
              <div className="min-w-0">
                <h4 id="product-drilldown-title" className="text-base font-semibold text-gray-900 dark:text-white">
                  Invoices — {modalTitle}
                </h4>
                {modalItemCode ? (
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{modalItemCode}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-auto flex-1 p-3 sm:p-4">
              {drilldownLoading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-gray-500">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Loading…
                </div>
              ) : drilldownError ? (
                <p className="text-sm text-red-600 dark:text-red-400 py-6 text-center">{drilldownError}</p>
              ) : drilldownRows.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-8">No invoice lines in this period.</p>
              ) : (
                <table className="min-w-full text-xs sm:text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-600">
                      <th className="pb-2 pr-2">Invoice</th>
                      <th className="pb-2 pr-2 hidden sm:table-cell">Date</th>
                      <th className="pb-2 pr-2 text-right">Qty</th>
                      <th className="pb-2 pr-2 text-right hidden md:table-cell">Sell / unit</th>
                      <th className="pb-2 pr-2 text-right hidden md:table-cell">Buy / unit</th>
                      <th className="pb-2 pr-2 text-right hidden lg:table-cell">Revenue</th>
                      <th className="pb-2 pr-2 text-right hidden lg:table-cell">Cost</th>
                      <th className="pb-2 pr-2 text-right">Profit</th>
                      <th className="pb-2 text-right">Margin %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drilldownRows.map((r, idx) => (
                      <tr key={`${r.invoice}-${idx}`} className="border-b border-gray-100 dark:border-gray-700/80">
                        <td className="py-2 pr-2">
                          <Link
                            to={`/invoice/${r.invoice}`}
                            className="font-mono text-brand-600 hover:underline dark:text-brand-400 break-all"
                            onClick={closeModal}
                          >
                            {r.invoice}
                          </Link>
                        </td>
                        <td className="py-2 pr-2 hidden sm:table-cell whitespace-nowrap text-gray-600 dark:text-gray-400">
                          {r.posting_date}
                          {r.posting_time ? ` ${r.posting_time.slice(0, 5)}` : ""}
                        </td>
                        <td className="py-2 pr-2 text-right">{r.qty}</td>
                        <td className="py-2 pr-2 text-right hidden md:table-cell">
                          {formatCurrency(r.unit_sell_net, drilldownCurrency)}
                        </td>
                        <td className="py-2 pr-2 text-right hidden md:table-cell">
                          {formatCurrency(r.unit_buy, drilldownCurrency)}
                        </td>
                        <td className="py-2 pr-2 text-right hidden lg:table-cell">
                          {formatCurrency(r.line_revenue, drilldownCurrency)}
                        </td>
                        <td className="py-2 pr-2 text-right hidden lg:table-cell">
                          {formatCurrency(r.line_cost, drilldownCurrency)}
                        </td>
                        <td className={`py-2 pr-2 text-right font-medium ${profitColorClass(r.line_profit)}`}>
                          {formatCurrency(r.line_profit, drilldownCurrency)}
                        </td>
                        <td className="py-2 text-right">{r.margin_pct.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
