import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  ClipboardList,
  RefreshCw,
  FileDown,
  ChevronLeft,
  ChevronRight,
  Calendar,
} from "lucide-react";
import { NepaliDatePicker } from "nepali-datepicker-reactjs";
import "nepali-datepicker-reactjs/dist/index.css";
import BottomNavigation from "../components/BottomNavigation";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useUserInfo } from "../hooks/useUserInfo";
import { formatCurrency } from "../utils/currency";
import { toast } from "react-toastify";

const PAGE_SIZE = 100;
const API = "/api/method/klik_pos.api.date_wise_inventory";
const BS_YEAR_START = 2075;

function _errMsg(m: unknown): string | null {
  if (m == null) return null;
  if (typeof m === "string") return m;
  if (typeof m === "object") {
    const o = m as Record<string, unknown>;
    if (typeof o.exc === "string") {
      const lines = o.exc.trim().split("\n");
      return lines[lines.length - 1] || o.exc;
    }
    if (typeof o._server_messages === "string") {
      try {
        const arr = JSON.parse(o._server_messages);
        const last = arr?.[arr.length - 1];
        if (last && typeof last === "object" && "message" in last) return (last as { message: string }).message;
      } catch {
        return o._server_messages as string;
      }
    }
    if (typeof o.error === "string") return o.error;
    if (typeof o.message === "string") return o.message;
  }
  return null;
}
const BS_YEAR_END = 2095;

function bsDateToStr(d: BSDate): string {
  const y = d.year;
  const m = String(d.month).padStart(2, "0");
  const day = String(d.day).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseBsDateStr(s: string): BSDate | null {
  if (!s || typeof s !== "string") return null;
  const parts = s.trim().split("-");
  if (parts.length !== 3) return null;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return null;
  return { year, month, day };
}

interface ColumnDef {
  label: string;
  fieldname: string;
  fieldtype?: string;
  width?: number;
}

interface DateWiseInventoryResponse {
  columns: ColumnDef[];
  result: Record<string, unknown>[];
  total_count: number;
  page: number;
  page_size: number;
}

interface BSDate {
  year: number;
  month: number;
  day: number;
}

interface FilterOption {
  value: string;
  label: string;
}

export default function DateWiseInventoryPage() {
  const navigate = useNavigate();
  const isMobile = useMediaQuery("(max-width: 1024px)");
  const { userInfo, isLoading: userInfoLoading } = useUserInfo();

  const [fromBs, setFromBs] = useState<BSDate>({ year: 2081, month: 1, day: 1 });
  const [toBs, setToBs] = useState<BSDate>({ year: 2081, month: 1, day: 1 });
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [company, setCompany] = useState("");
  const [itemCode, setItemCode] = useState("");
  const [itemGroup, setItemGroup] = useState("");
  const [warehouse, setWarehouse] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<DateWiseInventoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingDefaults, setLoadingDefaults] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasRequested, setHasRequested] = useState(false);

  const [companies, setCompanies] = useState<FilterOption[]>([]);
  const [itemGroups, setItemGroups] = useState<FilterOption[]>([]);
  const [warehouses, setWarehouses] = useState<FilterOption[]>([]);
  const [items, setItems] = useState<FilterOption[]>([]);
  const [itemSearch, setItemSearch] = useState("");
  const [loadingOptions, setLoadingOptions] = useState(true);

  const canAccess =
    userInfo?.is_administrator === true || userInfo?.can_access_date_wise_inventory === true;

  const loadFilterOptions = useCallback(async () => {
    setLoadingOptions(true);
    try {
      const res = await fetch(`${API}.get_filter_options`, { credentials: "include" });
      const json = await res.json();
      if (json.message?.companies) {
        setCompanies(json.message.companies || []);
        setItemGroups(json.message.item_groups || []);
        setWarehouses(json.message.warehouses || []);
      }
    } catch {
      toast.error("Could not load filter options.");
    } finally {
      setLoadingOptions(false);
    }
  }, []);

  const loadItems = useCallback(async (search: string) => {
    try {
      const params = new URLSearchParams({ search: search || "", limit: "100" });
      const res = await fetch(`${API}.get_items_search?${params}`, { credentials: "include" });
      const json = await res.json();
      if (Array.isArray(json.message)) {
        setItems(json.message);
      }
    } catch {
      setItems([]);
    }
  }, []);

  const loadDefaults = useCallback(async () => {
    setLoadingDefaults(true);
    try {
      const res = await fetch(`${API}.get_bs_defaults`, { credentials: "include" });
      const json = await res.json();
      if (json.message?.success && json.message?.data) {
        const d = json.message.data;
        if (d.from_date_bs?.year != null) {
          setFromBs({
            year: d.from_date_bs.year,
            month: d.from_date_bs.month,
            day: d.from_date_bs.day,
          });
          setToBs({
            year: d.to_date_bs.year,
            month: d.to_date_bs.month,
            day: d.to_date_bs.day,
          });
        }
        if (d.from_date_ad) setFromDate(d.from_date_ad);
        if (d.to_date_ad) setToDate(d.to_date_ad);
      }
    } catch {
      const now = new Date();
      setFromDate(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));
      setToDate(now.toISOString().slice(0, 10));
    } finally {
      setLoadingDefaults(false);
    }
  }, []);

  useEffect(() => {
    loadDefaults();
    loadFilterOptions();
  }, [loadDefaults, loadFilterOptions]);

  useEffect(() => {
    const t = setTimeout(() => loadItems(itemSearch), 300);
    return () => clearTimeout(t);
  }, [itemSearch, loadItems]);

  const fetchData = useCallback(
    async (skipCache = false, pageOverride?: number) => {
      let from = fromDate;
      let to = toDate;
      if (fromBs.year && toBs.year) {
        try {
          const rangeParams = new URLSearchParams({
            from_year: String(fromBs.year),
            from_month: String(fromBs.month),
            from_day: String(fromBs.day),
            to_year: String(toBs.year),
            to_month: String(toBs.month),
            to_day: String(toBs.day),
          });
          const resRange = await fetch(`${API}.bs_range_to_ad?${rangeParams}`, { credentials: "include" });
          const jsonRange = await resRange.json();
          const msg = jsonRange.message;
          if (msg && typeof msg === "object" && msg.from_date_ad && msg.to_date_ad) {
            from = msg.from_date_ad;
            to = msg.to_date_ad;
            setFromDate(from);
            setToDate(to);
          } else {
            const err = _errMsg(msg) || jsonRange.exc || "Invalid BS date range.";
            throw new Error(err);
          }
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : "Invalid BS date.";
          setError(errMsg);
          toast.error(errMsg);
          setLoading(false);
          return;
        }
      }
      if (!from || !to) {
        toast.error("Please set From Date and To Date (BS).");
        return;
      }
      const currentPage = pageOverride ?? page;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          filters: JSON.stringify({
            from_date: from,
            to_date: to,
            ...(company && { company }),
            ...(itemCode && { item_code: itemCode }),
            ...(itemGroup && { item_group: itemGroup }),
            ...(warehouse && { warehouse }),
          }),
          page: String(currentPage),
          page_size: String(PAGE_SIZE),
          skip_cache: skipCache ? "1" : "0",
        });
        const res = await fetch(`${API}.get_data?${params}`, { credentials: "include" });
        const json = await res.json();
        const msg = json.message;
        if (!res.ok) {
          const errMsg = _errMsg(msg) || json.exc || "Failed to load data";
          throw new Error(errMsg);
        }
        if (msg && typeof msg === "object" && msg.error) {
          throw new Error(_errMsg(msg) || String(msg.error));
        }
        if (json.message?.columns) {
          setData({
            columns: json.message.columns,
            result: json.message.result || [],
            total_count: json.message.total_count ?? 0,
            page: json.message.page ?? currentPage,
            page_size: json.message.page_size ?? PAGE_SIZE,
          });
          if (pageOverride != null) setPage(pageOverride);
        } else {
          setData(null);
          setError("Invalid response from server.");
        }
        setHasRequested(true);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unable to load data.";
        setError(msg);
        setData(null);
        toast.error(msg);
      } finally {
        setLoading(false);
      }
    },
    [fromDate, toDate, fromBs, toBs, company, itemCode, itemGroup, warehouse, page]
  );

  const handleGetData = () => {
    setPage(1);
    fetchData(false, 1);
  };
  const handleRefresh = () => fetchData(true);

  const handleExportPdf = async () => {
    let from = fromDate;
    let to = toDate;
    if (fromBs.year && toBs.year) {
      try {
        const params = new URLSearchParams({
          from_year: String(fromBs.year),
          from_month: String(fromBs.month),
          from_day: String(fromBs.day),
          to_year: String(toBs.year),
          to_month: String(toBs.month),
          to_day: String(toBs.day),
        });
        const res = await fetch(`${API}.bs_range_to_ad?${params}`, { credentials: "include" });
        const json = await res.json();
        if (json.message?.from_date_ad && json.message?.to_date_ad) {
          from = json.message.from_date_ad;
          to = json.message.to_date_ad;
        }
      } catch {
        toast.error("Invalid BS date for export.");
        return;
      }
    }
    if (!from || !to) {
      toast.error("Please set From Date and To Date.");
      return;
    }
    const filters = {
      from_date: from,
      to_date: to,
      ...(company && { company }),
      ...(itemCode && { item_code: itemCode }),
      ...(itemGroup && { item_group: itemGroup }),
      ...(warehouse && { warehouse }),
    };
    const q = new URLSearchParams({ filters: JSON.stringify(filters) });
    window.open(`${API}.export_pdf?${q}`, "_blank", "noopener,noreferrer");
  };

  const setCurrentBsMonth = async () => {
    setLoadingDefaults(true);
    try {
      const res = await fetch(`${API}.get_bs_defaults`, { credentials: "include" });
      const json = await res.json();
      if (json.message?.success && json.message?.data) {
        const d = json.message.data;
        if (d.from_date_bs?.year != null) {
          setFromBs({
            year: d.from_date_bs.year,
            month: d.from_date_bs.month,
            day: d.from_date_bs.day,
          });
          setToBs({
            year: d.to_date_bs.year,
            month: d.to_date_bs.month,
            day: d.to_date_bs.day,
          });
        }
        if (d.from_date_ad) setFromDate(d.from_date_ad);
        if (d.to_date_ad) setToDate(d.to_date_ad);
        toast.success("Dates set to current BS month.");
      }
    } catch {
      toast.error("Could not load BS defaults.");
    } finally {
      setLoadingDefaults(false);
    }
  };

  if (userInfoLoading || !userInfo) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-beveren-50 to-beveren-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-beveren-600" />
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-beveren-50 to-beveren-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <p className="text-gray-700 dark:text-gray-300 mb-4">You do not have permission to view Date Wise Inventory.</p>
          <button
            type="button"
            onClick={() => navigate("/pos")}
            className="px-4 py-2 bg-beveren-600 text-white rounded-lg hover:bg-beveren-700"
          >
            Back to POS
          </button>
        </div>
      </div>
    );
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total_count / PAGE_SIZE)) : 0;
  const displayColumns = data?.columns ?? [];
  const displayFields = ["date", "item_code", "item_name", "warehouse", "opening_qty", "in_qty", "out_qty", "qty_after_transaction", "valuation_rate", "stock_value"];
  const floatFields = new Set(["opening_qty", "in_qty", "out_qty", "qty_after_transaction", "valuation_rate", "stock_value", "opening_stock_value"]);

  const selectClass =
    "w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-2 text-sm";

  return (
    <div className="min-h-screen bg-gradient-to-br from-beveren-50 to-beveren-100 dark:from-gray-900 dark:to-gray-800 pb-20 lg:pb-8">
      <div className={`p-4 ${isMobile ? "pt-6" : "pt-8"} max-w-7xl mx-auto lg:pl-24`}>
        <div className="flex items-center gap-2 mb-6">
          <ClipboardList className="w-8 h-8 text-beveren-600" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Date Wise Inventory</h1>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 mb-6">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">Dates in Bikram Sambat (BS). Select From and To date below.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">From Date (BS)</label>
              <div className="nepali-date-picker-wrapper">
                <NepaliDatePicker
                  value={bsDateToStr(fromBs)}
                  onChange={(value) => {
                    const parsed = parseBsDateStr(value);
                    if (parsed) setFromBs(parsed);
                  }}
                  options={{
                    calenderLocale: "en",
                    valueLocale: "en",
                    closeOnSelect: true,
                  }}
                  minYear={BS_YEAR_START}
                  maxYear={BS_YEAR_END}
                  className="w-full"
                  inputClassName={`${selectClass} w-full`}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">To Date (BS)</label>
              <div className="nepali-date-picker-wrapper">
                <NepaliDatePicker
                  value={bsDateToStr(toBs)}
                  onChange={(value) => {
                    const parsed = parseBsDateStr(value);
                    if (parsed) setToBs(parsed);
                  }}
                  options={{
                    calenderLocale: "en",
                    valueLocale: "en",
                    closeOnSelect: true,
                  }}
                  minYear={BS_YEAR_START}
                  maxYear={BS_YEAR_END}
                  className="w-full"
                  inputClassName={`${selectClass} w-full`}
                />
              </div>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={setCurrentBsMonth}
                disabled={loadingDefaults}
                className="flex items-center gap-2 px-3 py-2 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                <Calendar size={16} />
                Use current BS month
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Company</label>
              <select
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className={selectClass}
                disabled={loadingOptions}
              >
                <option value="">All / Default from POS</option>
                {companies.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Item</label>
              <input
                type="text"
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                placeholder="Search item (type to filter list)..."
                className="mb-1 w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-2 text-sm"
              />
              <select
                value={itemCode}
                onChange={(e) => setItemCode(e.target.value)}
                className={selectClass}
                disabled={loadingOptions}
              >
                <option value="">All Items</option>
                {items.map((i) => (
                  <option key={i.value} value={i.value}>{i.label} ({i.value})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Item Group</label>
              <select
                value={itemGroup}
                onChange={(e) => setItemGroup(e.target.value)}
                className={selectClass}
                disabled={loadingOptions}
              >
                <option value="">All</option>
                {itemGroups.map((g) => (
                  <option key={g.value} value={g.value}>{g.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Warehouse</label>
              <select
                value={warehouse}
                onChange={(e) => setWarehouse(e.target.value)}
                className={selectClass}
                disabled={loadingOptions}
              >
                <option value="">All</option>
                {warehouses.map((w) => (
                  <option key={w.value} value={w.value}>{w.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleGetData}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-beveren-600 text-white rounded-lg hover:bg-beveren-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
              ) : null}
              Get Data
            </button>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50"
            >
              <RefreshCw size={18} />
              Refresh
            </button>
            <button
              type="button"
              onClick={handleExportPdf}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 disabled:opacity-50"
            >
              <FileDown size={18} />
              Export PDF
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <span className="animate-spin rounded-full h-10 w-10 border-2 border-beveren-600 border-t-transparent" />
            </div>
          )}
          {!loading && data && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-700/50">
                      {displayFields
                        .filter((f) => displayColumns.some((c) => c.fieldname === f))
                        .map((f) => {
                          const col = displayColumns.find((c) => c.fieldname === f);
                          return (
                            <th
                              key={f}
                              className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300 border-b border-gray-200 dark:border-gray-600"
                            >
                              {col?.label ?? f}
                            </th>
                          );
                        })}
                    </tr>
                  </thead>
                  <tbody>
                    {data.result.length === 0 ? (
                      <tr>
                        <td colSpan={displayFields.length} className="px-4 py-8 text-center text-gray-500">
                          No data. Set dates and click Get Data.
                        </td>
                      </tr>
                    ) : (
                      data.result.map((row, idx) => (
                        <tr
                          key={idx}
                          className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30"
                        >
                          {displayFields
                            .filter((f) => displayColumns.some((c) => c.fieldname === f))
                            .map((f) => {
                              let val = row[f];
                              if (val != null && typeof val === "object" && "isoformat" in (val as object)) {
                                val = (val as { isoformat: () => string }).isoformat?.() ?? String(val);
                              }
                              if (val == null) val = "";
                              if (floatFields.has(f) && typeof val === "number") {
                                val = Number.isInteger(val) ? val : (val as number).toFixed(2);
                              }
                              if (f === "stock_value" || f === "opening_stock_value" || f === "valuation_rate") {
                                const num = Number(val);
                                if (!Number.isNaN(num)) val = formatCurrency(num);
                              }
                              if (f === "date" && typeof val === "string" && (val.includes("T") || val.includes(" "))) {
                                val = val.slice(0, 10);
                              }
                              return (
                                <td
                                  key={f}
                                  className="px-4 py-2 text-gray-900 dark:text-gray-200 whitespace-nowrap"
                                >
                                  {String(val)}
                                </td>
                              );
                            })}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {data.total_count > 0 && (
                <div className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-700/30 border-t border-gray-200 dark:border-gray-600">
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    Page {data.page} of {totalPages} ({data.total_count} rows)
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const prev = Math.max(1, page - 1);
                        setPage(prev);
                        fetchData(false, prev);
                      }}
                      disabled={page <= 1}
                      className="p-2 rounded-lg border border-gray-300 dark:border-gray-600 disabled:opacity-50"
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const next = page + 1;
                        setPage(next);
                        fetchData(false, next);
                      }}
                      disabled={page >= totalPages}
                      className="p-2 rounded-lg border border-gray-300 dark:border-gray-600 disabled:opacity-50"
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          {!loading && !data && !error && (
            <div className="py-12 text-center text-gray-500">Set From/To date (BS), then click Get Data.</div>
          )}
        </div>
      </div>
      {isMobile && <BottomNavigation />}
    </div>
  );
}
