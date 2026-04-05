"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Info, Loader2, Package, TrendingDown, Receipt } from "lucide-react";
import { usePOSDetails } from "../hooks/usePOSProfile";
import { formatGroupedAmount } from "../utils/currency";

interface PurchaseHistoryRecord {
  supplier: string;
  supplier_name: string;
  purchase_rate: number;
  qty: number;
  posting_date: string;
  posting_time: string;
  invoice_name: string;
}

interface BuyingPriceRow {
  price_list: string;
  price_list_rate: number;
  uom: string | null;
  valid_from: string;
  valid_upto: string;
  creation: string;
  is_current: boolean;
}

type HistoryTab = "purchases" | "prices";

interface ItemPurchaseHistoryModalProps {
  itemCode: string;
  itemName: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function ItemPurchaseHistoryModal({
  itemCode,
  itemName,
  isOpen,
  onClose,
}: ItemPurchaseHistoryModalProps) {
  const [tab, setTab] = useState<HistoryTab>("purchases");
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [purchaseError, setPurchaseError] = useState("");
  const [purchaseHistory, setPurchaseHistory] = useState<PurchaseHistoryRecord[]>([]);
  const [purchaseEmpty, setPurchaseEmpty] = useState(false);

  const [priceLoading, setPriceLoading] = useState(false);
  const [priceError, setPriceError] = useState("");
  const [priceRows, setPriceRows] = useState<BuyingPriceRow[]>([]);

  const { posDetails } = usePOSDetails();
  const currency_symbol = posDetails?.currency_symbol || "₨";

  const fetchPurchaseHistory = useCallback(async () => {
    if (!itemCode) return;
    setPurchaseLoading(true);
    setPurchaseError("");
    setPurchaseEmpty(false);
    try {
      const response = await fetch(
        `/api/method/klik_pos.api.item.get_item_purchase_history?item_code=${encodeURIComponent(itemCode)}&limit=5`,
        { method: "GET", credentials: "include" }
      );
      const data = await response.json();
      if (data.message?.success) {
        const historyData = data.message.data || [];
        setPurchaseHistory(historyData);
        setPurchaseEmpty(historyData.length === 0);
      } else {
        setPurchaseError(data.message?.error || "Failed to fetch purchase history");
      }
    } catch {
      setPurchaseError("Failed to fetch purchase history");
    } finally {
      setPurchaseLoading(false);
    }
  }, [itemCode]);

  const fetchPriceHistory = useCallback(async () => {
    if (!itemCode) return;
    setPriceLoading(true);
    setPriceError("");
    try {
      const response = await fetch(
        `/api/method/klik_pos.api.item.get_item_buying_price_history?item_code=${encodeURIComponent(itemCode)}&limit=15`,
        { method: "GET", credentials: "include" }
      );
      const data = await response.json();
      if (data.message?.success) {
        setPriceRows(data.message.data || []);
      } else {
        setPriceError(data.message?.error || "Failed to load price history");
      }
    } catch {
      setPriceError("Failed to load price history");
    } finally {
      setPriceLoading(false);
    }
  }, [itemCode]);

  useEffect(() => {
    if (!isOpen) return;
    setTab("purchases");
    void fetchPurchaseHistory();
  }, [isOpen, itemCode, fetchPurchaseHistory]);

  useEffect(() => {
    if (!isOpen || tab !== "prices") return;
    void fetchPriceHistory();
  }, [isOpen, tab, itemCode, fetchPriceHistory]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [isOpen, onClose]);

  const formatDate = (dateStr: string, timeStr: string) => {
    if (!dateStr) return "-";
    try {
      const date = new Date(dateStr);
      const formattedDate = date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      return timeStr ? `${formattedDate} ${timeStr}` : formattedDate;
    } catch {
      return dateStr;
    }
  };

  const formatValidDate = (s: string) => {
    if (!s) return "—";
    try {
      return new Date(s).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return s;
    }
  };

  if (!isOpen) return null;

  const tabBtn = (id: HistoryTab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-colors ${
        tab === id
          ? "bg-amber-600 text-white shadow-sm"
          : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-[90%] max-w-[520px] max-h-[80vh] overflow-hidden animate-in fade-in-0 zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-800/50 flex items-center justify-center">
              <TrendingDown size={20} className="text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                Buying context
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Purchases vs Item Price (buying) timeline
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            <X size={20} className="text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        <div className="px-6 py-3 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
          <p className="text-base font-medium text-gray-800 dark:text-gray-200 truncate" title={itemName}>
            {itemName}
          </p>
        </div>

        <div className="px-4 pt-3 pb-2 flex gap-2 border-b border-gray-200 dark:border-gray-700">
          {tabBtn("purchases", "Purchase history")}
          {tabBtn("prices", "Price history")}
        </div>

        <div className="p-6 overflow-y-auto max-h-[50vh]">
          {tab === "purchases" && (
            <>
              {purchaseLoading ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 size={40} className="text-amber-600 animate-spin mb-4" />
                  <span className="text-base text-gray-500 dark:text-gray-400">
                    Loading purchase history…
                  </span>
                </div>
              ) : purchaseError ? (
                <div className="text-center py-12">
                  <p className="text-lg font-medium text-red-600 dark:text-red-400">{purchaseError}</p>
                </div>
              ) : purchaseEmpty ? (
                <div className="text-center py-12">
                  <div className="w-20 h-20 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center mx-auto mb-4">
                    <Package size={40} className="text-gray-400 dark:text-gray-500" />
                  </div>
                  <p className="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    No purchases found
                  </p>
                  <p className="text-base text-gray-500 dark:text-gray-400">
                    This item has not been purchased from any supplier yet
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Last 5 purchases (lowest rate first)
                  </p>
                  <div className="grid grid-cols-12 gap-3 text-sm font-semibold text-gray-500 dark:text-gray-400 pb-3 border-b-2 border-gray-200 dark:border-gray-600">
                    <div className="col-span-5">Supplier</div>
                    <div className="col-span-3 text-right">Rate</div>
                    <div className="col-span-4 text-right">Date</div>
                  </div>
                  {purchaseHistory.map((record, index) => (
                    <div
                      key={`${record.invoice_name}-${index}`}
                      className={`grid grid-cols-12 gap-3 py-4 rounded-xl ${
                        index === 0
                          ? "bg-green-50 dark:bg-green-900/20 px-4 border-2 border-green-300 dark:border-green-700"
                          : "bg-gray-50 dark:bg-gray-700/30 px-4 border border-gray-200 dark:border-gray-600"
                      }`}
                    >
                      <div className="col-span-5">
                        <span
                          className="text-base font-medium text-gray-900 dark:text-white block truncate"
                          title={record.supplier_name}
                        >
                          {record.supplier_name || record.supplier}
                        </span>
                        {index === 0 && (
                          <span className="inline-block mt-1 px-2 py-0.5 text-xs font-bold text-green-700 dark:text-green-300 bg-green-200 dark:bg-green-800/50 rounded-full">
                            BEST RATE
                          </span>
                        )}
                      </div>
                      <div
                        className={`col-span-3 text-right text-lg font-bold ${
                          index === 0
                            ? "text-green-600 dark:text-green-400"
                            : "text-amber-600 dark:text-amber-400"
                        }`}
                      >
                        {currency_symbol}
                        {formatGroupedAmount(record.purchase_rate)}
                      </div>
                      <div className="col-span-4 text-right text-sm text-gray-500 dark:text-gray-400 self-center">
                        {formatDate(record.posting_date, record.posting_time)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {tab === "prices" && (
            <>
              {priceLoading ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 size={40} className="text-amber-600 animate-spin mb-4" />
                  <span className="text-base text-gray-500 dark:text-gray-400">
                    Loading buying price list…
                  </span>
                </div>
              ) : priceError ? (
                <div className="text-center py-12">
                  <p className="text-lg font-medium text-red-600 dark:text-red-400">{priceError}</p>
                </div>
              ) : priceRows.length === 0 ? (
                <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                  <Receipt className="mx-auto mb-3 opacity-50" size={40} />
                  <p>No buying Item Price records found</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Buying price list entries (valid from / until)
                  </p>
                  <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-gray-500 dark:text-gray-400 pb-2 border-b border-gray-200 dark:border-gray-600">
                    <div className="col-span-3 text-right">Rate</div>
                    <div className="col-span-3">Valid from</div>
                    <div className="col-span-3">Valid until</div>
                    <div className="col-span-3 truncate">Price list</div>
                  </div>
                  {priceRows.map((row, index) => (
                    <div
                      key={`${row.price_list}-${row.creation}-${index}`}
                      className={`grid grid-cols-12 gap-2 py-3 px-3 rounded-lg text-sm items-center ${
                        row.is_current
                          ? "bg-violet-50 dark:bg-violet-900/25 border border-violet-200 dark:border-violet-800"
                          : "bg-gray-50 dark:bg-gray-700/30 border border-gray-200 dark:border-gray-600"
                      }`}
                    >
                      <div className="col-span-3 text-right font-bold text-amber-600 dark:text-amber-400">
                        {currency_symbol}
                        {formatGroupedAmount(row.price_list_rate)}
                      </div>
                      <div className="col-span-3 text-gray-700 dark:text-gray-300">
                        {formatValidDate(row.valid_from) || formatValidDate(row.creation)}
                      </div>
                      <div className="col-span-3 text-gray-600 dark:text-gray-400">
                        {row.valid_upto ? formatValidDate(row.valid_upto) : "Open"}
                      </div>
                      <div className="col-span-3 truncate text-gray-600 dark:text-gray-400" title={row.price_list}>
                        {row.price_list}
                        {row.is_current && (
                          <span className="ml-1 text-[10px] font-bold text-violet-600 dark:text-violet-300">
                            CURRENT
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
          <button
            onClick={onClose}
            className="w-full py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-xl transition-colors text-base"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

interface PurchaseHistoryInfoButtonProps {
  itemCode: string;
  itemName: string;
  className?: string;
}

export function PurchaseHistoryInfoButton({
  itemCode,
  itemName,
  className = "",
}: PurchaseHistoryInfoButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(true);
        }}
        className={`w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center hover:bg-blue-200 dark:hover:bg-blue-800/50 transition-all ${className}`}
        title="View purchase & price history"
      >
        <Info size={12} className="text-blue-600 dark:text-blue-400" />
      </button>

      <ItemPurchaseHistoryModal
        itemCode={itemCode}
        itemName={itemName}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
      />
    </>
  );
}
