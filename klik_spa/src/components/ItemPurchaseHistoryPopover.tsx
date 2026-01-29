"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Info, Loader2, Package, TrendingDown } from "lucide-react";
import { usePOSDetails } from "../hooks/usePOSProfile";

interface PurchaseHistoryRecord {
  supplier: string;
  supplier_name: string;
  purchase_rate: number;
  qty: number;
  posting_date: string;
  posting_time: string;
  invoice_name: string;
}

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [purchaseHistory, setPurchaseHistory] = useState<PurchaseHistoryRecord[]>([]);
  const [noHistory, setNoHistory] = useState(false);
  const { posDetails } = usePOSDetails();
  const currency_symbol = posDetails?.currency_symbol || "₨";

  // Fetch purchase history
  const fetchPurchaseHistory = useCallback(async () => {
    if (!itemCode) return;

    setLoading(true);
    setError("");
    setNoHistory(false);

    try {
      const response = await fetch(
        `/api/method/klik_pos.api.item.get_item_purchase_history?item_code=${encodeURIComponent(itemCode)}&limit=5`,
        {
          method: "GET",
          credentials: "include",
        }
      );
      const data = await response.json();

      if (data.message?.success) {
        const historyData = data.message.data || [];
        setPurchaseHistory(historyData);
        setNoHistory(historyData.length === 0);
      } else {
        setError(data.message?.error || "Failed to fetch purchase history");
      }
    } catch (err) {
      console.error("Error fetching purchase history:", err);
      setError("Failed to fetch purchase history");
    } finally {
      setLoading(false);
    }
  }, [itemCode]);

  // Fetch on open
  useEffect(() => {
    if (isOpen) {
      fetchPurchaseHistory();
    }
  }, [isOpen, fetchPurchaseHistory]);

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [isOpen, onClose]);

  // Format date for display
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

  if (!isOpen) return null;

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Modal */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-[90%] max-w-[500px] max-h-[80vh] overflow-hidden animate-in fade-in-0 zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-800/50 flex items-center justify-center">
              <TrendingDown size={20} className="text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                Purchase History
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Last 5 purchases (sorted by lowest rate)
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

        {/* Item name banner */}
        <div className="px-6 py-3 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-700">
          <p className="text-base font-medium text-gray-800 dark:text-gray-200 truncate" title={itemName}>
            {itemName}
          </p>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[50vh]">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 size={40} className="text-amber-600 animate-spin mb-4" />
              <span className="text-base text-gray-500 dark:text-gray-400">Loading purchase history...</span>
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mx-auto mb-4">
                <X size={32} className="text-red-500" />
              </div>
              <p className="text-lg font-medium text-red-600 dark:text-red-400">{error}</p>
            </div>
          ) : noHistory ? (
            <div className="text-center py-12">
              <div className="w-20 h-20 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center mx-auto mb-4">
                <Package size={40} className="text-gray-400 dark:text-gray-500" />
              </div>
              <p className="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-2">
                No Purchases Found
              </p>
              <p className="text-base text-gray-500 dark:text-gray-400">
                This item has not been purchased from any supplier yet
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Column headers */}
              <div className="grid grid-cols-12 gap-3 text-sm font-semibold text-gray-500 dark:text-gray-400 pb-3 border-b-2 border-gray-200 dark:border-gray-600">
                <div className="col-span-5">Supplier</div>
                <div className="col-span-3 text-right">Rate</div>
                <div className="col-span-4 text-right">Date</div>
              </div>

              {/* Purchase records - sorted by lowest rate first */}
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
                    <span className="text-base font-medium text-gray-900 dark:text-white block truncate" title={record.supplier_name}>
                      {record.supplier_name || record.supplier}
                    </span>
                    {index === 0 && (
                      <span className="inline-block mt-1 px-2 py-0.5 text-xs font-bold text-green-700 dark:text-green-300 bg-green-200 dark:bg-green-800/50 rounded-full">
                        BEST RATE
                      </span>
                    )}
                  </div>
                  <div className={`col-span-3 text-right text-lg font-bold ${
                    index === 0 ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"
                  }`}>
                    {currency_symbol}{record.purchase_rate.toFixed(2)}
                  </div>
                  <div className="col-span-4 text-right text-sm text-gray-500 dark:text-gray-400 self-center">
                    {formatDate(record.posting_date, record.posting_time)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
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

// Info button component for easy integration
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
        title="View purchase history"
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
