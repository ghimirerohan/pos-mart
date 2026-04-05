"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Minus,
  Plus,
  X,
  Search,
  UserPlus,
  Truck,
  ChevronRight,
  ArrowUp,
} from "lucide-react";
import type { PurchaseCartItem, Supplier } from "../types/supplier";
import PurchasePaymentDialog from "./PurchasePaymentDialog";
import AddSupplierModal from "./AddSupplierModal";
import { PurchaseHistoryInfoButton } from "./ItemPurchaseHistoryPopover";
import { usePurchaseCartStore } from "../stores/purchaseCartStore";
import { toast } from "react-toastify";
import { usePOSDetails } from "../hooks/usePOSProfile";
import { formatGroupedAmount } from "../utils/currency";

/** Cart line identity (not SKU). `id` is item_code; supplier/quantity edits must target one row. */
function purchaseRowKey(item: PurchaseCartItem): string {
  return item.cart_row_id ?? item.id;
}

interface PurchaseOrderSummaryProps {
  cartItems: PurchaseCartItem[];
  onUpdateQuantity: (id: string, quantity: number) => void;
  onRemoveItem?: (id: string) => void;
  onClearCart?: () => void;
  isMobile?: boolean;
}

// Price Input Component
interface PriceInputProps {
  value: number;
  onChange: (value: number) => void;
  label: string;
  currencySymbol?: string;
  className?: string;
}

const PriceInput = ({ value, onChange, label, currencySymbol = "₨", className = "" }: PriceInputProps) => {
  const [inputValue, setInputValue] = useState(value.toString());
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (!isEditing) {
      setInputValue(value.toFixed(2));
    }
  }, [value, isEditing]);

  const handleBlur = () => {
    setIsEditing(false);
    const numValue = parseFloat(inputValue);
    if (isNaN(numValue) || numValue < 0) {
      setInputValue(value.toFixed(2));
    } else {
      onChange(numValue);
    }
  };

  return (
    <div className={`flex items-center ${className}`}>
      <span className="text-xs text-gray-500 dark:text-gray-400 mr-2 whitespace-nowrap">
        {label}:
      </span>
      <div className="relative flex-1">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">
          {currencySymbol}
        </span>
        <input
          type="number"
          step="0.01"
          min="0"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onFocus={() => setIsEditing(true)}
          onBlur={handleBlur}
          className="w-full pl-6 pr-2 py-1 text-xs border border-amber-300 dark:border-amber-600 rounded focus:ring-1 focus:ring-amber-500 focus:border-amber-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
        />
      </div>
    </div>
  );
};

export default function PurchaseOrderSummary({
  cartItems,
  onUpdateQuantity,
  onRemoveItem,
  onClearCart,
  isMobile = false,
}: PurchaseOrderSummaryProps) {
  const { posDetails } = usePOSDetails();
  const currency_symbol = posDetails?.currency_symbol || "₨";

  // Supplier state
  const [supplierSearch, setSupplierSearch] = useState("");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [showSupplierDropdown, setShowSupplierDropdown] = useState(false);
  const defaultSupplierPickerRef = useRef<HTMLDivElement>(null);
  const [showAddSupplierModal, setShowAddSupplierModal] = useState(false);
  const [loadingSuppliers, setLoadingSuppliers] = useState(false);

  // UI State
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);

  // Get store actions
  const {
    selectedSupplier,
    setSelectedSupplier,
    updatePurchasePrice,
    updateSellingPrice,
    updateBatch,
    updateBatchExpiryDate,
    updateSerial,
    setItemSupplier,
    copySupplierFromAbove,
  } = usePurchaseCartStore();

  const [supplierPickerLineId, setSupplierPickerLineId] = useState<string | null>(null);
  const [lastSupplierLoadingId, setLastSupplierLoadingId] = useState<string | null>(null);
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerSuppliers, setPickerSuppliers] = useState<Supplier[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  const searchSuppliers = useCallback(async (search: string) => {
    setLoadingSuppliers(true);
    try {
      const response = await fetch(
        `/api/method/klik_pos.api.supplier.get_suppliers?search=${encodeURIComponent(search)}&limit=20`,
        {
          method: "GET",
          credentials: "include",
        }
      );
      const data = await response.json();
      if (data.message?.success) {
        setSuppliers(data.message.data || []);
      }
    } catch (error) {
      console.error("Error searching suppliers:", error);
    } finally {
      setLoadingSuppliers(false);
    }
  }, []);

  const searchPickerSuppliers = useCallback(async (search: string) => {
    setPickerLoading(true);
    try {
      const response = await fetch(
        `/api/method/klik_pos.api.supplier.get_suppliers?search=${encodeURIComponent(search)}&limit=20`,
        { method: "GET", credentials: "include" }
      );
      const data = await response.json();
      if (data.message?.success) {
        setPickerSuppliers(data.message.data || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setPickerLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      searchSuppliers(supplierSearch);
    }, 300);
    return () => clearTimeout(timer);
  }, [supplierSearch, searchSuppliers]);

  useEffect(() => {
    if (!supplierPickerLineId) return;
    const timer = setTimeout(() => {
      searchPickerSuppliers(pickerSearch);
    }, 300);
    return () => clearTimeout(timer);
  }, [pickerSearch, supplierPickerLineId, searchPickerSuppliers]);

  useEffect(() => {
    if (!showSupplierDropdown) return;
    const close = () => setShowSupplierDropdown(false);
    const onPointerDown = (e: PointerEvent) => {
      const root = defaultSupplierPickerRef.current;
      if (root && !root.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [showSupplierDropdown]);

  // Toggle item expansion
  const toggleItemExpansion = (itemId: string) => {
    setExpandedItems((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  };

  const handleSelectSupplier = (supplier: Supplier) => {
    setSelectedSupplier(supplier);
    setShowSupplierDropdown(false);
    setSupplierSearch("");
  };

  const assignSupplierToLine = (lineId: string, supplier: Supplier) => {
    setItemSupplier(lineId, supplier);
    setSupplierPickerLineId(null);
    setPickerSearch("");
  };

  // Handle new supplier saved
  const handleSaveSupplier = (supplier: Partial<Supplier>) => {
    const newSupplier: Supplier = {
      id: supplier.id || supplier.name || "",
      name: supplier.name || supplier.supplier_name || "",
      supplier_name: supplier.supplier_name || "",
      supplier_type: supplier.supplier_type || "Company",
      supplier_group: supplier.supplier_group || "All Supplier Groups",
      country: supplier.country || "Nepal",
      total_orders: supplier.total_orders || 0,
      total_spent: supplier.total_spent || 0,
    };
    setSelectedSupplier(newSupplier);
    setShowAddSupplierModal(false);
  };

  // Calculate totals
  const subtotal = cartItems.reduce(
    (sum, item) => sum + item.purchase_price * item.quantity,
    0
  );

  const validateForCheckout = (): boolean => {
    if (cartItems.length === 0) {
      toast.error("Cart is empty");
      return false;
    }
    const missing = cartItems.filter((it) => !it.supplier?.id);
    if (missing.length > 0) {
      toast.error("Assign a supplier to every line (use Last / pick supplier)");
      return false;
    }
    return true;
  };

  const applyLastBoughtSupplier = async (lineId: string, itemCode: string) => {
    setLastSupplierLoadingId(lineId);
    try {
      const res = await fetch(
        `/api/method/klik_pos.api.item.get_last_bought_supplier?item_code=${encodeURIComponent(itemCode)}`,
        { credentials: "include" }
      );
      const json = await res.json();
      const msg = json.message;
      if (!msg?.success) {
        toast.error(msg?.error || "Could not load last supplier");
        return;
      }
      const d = msg.data;
      if (!d?.supplier) {
        toast.info(msg.message || "No previous purchase for this item");
        return;
      }
      setItemSupplier(lineId, {
        id: d.supplier,
        name: d.supplier,
        supplier_name: d.supplier_name || d.supplier,
        supplier_type: "Company",
        supplier_group: "",
        country: "",
        total_orders: 0,
        total_spent: 0,
      });
      toast.success("Supplier set from last purchase");
    } catch {
      toast.error("Failed to load last supplier");
    } finally {
      setLastSupplierLoadingId(null);
    }
  };

  // Handle clear cart
  const handleClearCart = () => {
    if (onClearCart) {
      onClearCart();
    }
  };

  // Handle payment completion - called immediately on successful purchase
  // Clears the cart but keeps dialog open to show success message
  const handleCompletePayment = () => {
    if (onClearCart) {
      onClearCart();
    }
    // Note: Dialog is NOT closed here - user will see success message
    // and can close it with "New Purchase" button or X
  };

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700">
      {/* Default supplier — applied to newly added lines */}
      <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700">
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          Default supplier for <span className="font-medium">new</span> lines. Each line can use a different supplier; checkout creates one purchase invoice per supplier.
        </p>
        <div className="relative" ref={defaultSupplierPickerRef}>
          <div className="flex items-center">
            <div className="relative flex-1">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                type="text"
                placeholder="Default supplier search..."
                value={supplierSearch}
                onChange={(e) => {
                  setSupplierSearch(e.target.value);
                  setShowSupplierDropdown(true);
                }}
                onFocus={() => setShowSupplierDropdown(true)}
                className="w-full pl-10 pr-4 py-2 text-sm border border-amber-300 dark:border-amber-600 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <button
              onClick={() => setShowAddSupplierModal(true)}
              className="ml-2 p-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
              title="Add New Supplier"
            >
              <UserPlus size={16} />
            </button>
          </div>

          {/* Supplier Dropdown */}
          {showSupplierDropdown && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-10 max-h-60 overflow-y-auto">
              {loadingSuppliers ? (
                <div className="p-3 text-center text-gray-500">Loading...</div>
              ) : suppliers.length > 0 ? (
                suppliers.map((supplier) => (
                  <button
                    key={supplier.id}
                    onClick={() => handleSelectSupplier(supplier)}
                    className="w-full px-4 py-2 text-left hover:bg-amber-50 dark:hover:bg-amber-900/20 flex items-center"
                  >
                    <Truck size={16} className="text-amber-500 mr-2" />
                    <div>
                      <div className="text-sm font-medium text-gray-900 dark:text-white">
                        {supplier.supplier_name}
                      </div>
                      {supplier.contact?.phone && (
                        <div className="text-xs text-gray-500">
                          {supplier.contact.phone}
                          {supplier.total_orders > 0 && ` • ${supplier.total_orders} orders`}
                        </div>
                      )}
                    </div>
                  </button>
                ))
              ) : (
                <div className="p-3 text-center text-gray-500">
                  No suppliers found
                </div>
              )}
            </div>
          )}
        </div>

        {/* Selected Supplier Display */}
        {selectedSupplier && (
          <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-700">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <Truck size={20} className="text-amber-600 dark:text-amber-400 mr-2" />
                <div>
                  <div className="font-medium text-gray-900 dark:text-white">
                    {selectedSupplier.supplier_name}
                  </div>
                  {selectedSupplier.contact?.phone && (
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {selectedSupplier.contact.phone}
                      {selectedSupplier.total_orders > 0 && ` • ${selectedSupplier.total_orders} orders`}
                    </div>
                  )}
                </div>
              </div>
              <button
                onClick={() => setSelectedSupplier(null)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        )}

        {cartItems.length > 0 && (
          <div className="mt-3 p-2 bg-amber-50/80 dark:bg-amber-900/15 rounded-lg border border-amber-200 dark:border-amber-800/40">
            <p className="text-xs text-amber-800 dark:text-amber-200">
              Set supplier on each line (or use default above). All lines need a supplier before checkout.
            </p>
          </div>
        )}
      </div>

      {/* Cart Items */}
      <div className="flex-1 overflow-y-auto p-6 cart-scroll">
        <div className="space-y-4">
          {cartItems.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-6xl mb-4">📦</div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                No items to purchase
              </h3>
              <p className="text-gray-500 dark:text-gray-400">
                Add items to start a purchase
              </p>
            </div>
          ) : (
            cartItems.map((item, idx) => {
              const itemTotal = item.purchase_price * item.quantity;
              const aboveHasSupplier = idx > 0 && Boolean(cartItems[idx - 1]?.supplier?.id);

              return (
                <div
                  key={purchaseRowKey(item)}
                  className="bg-gray-50 dark:bg-gray-700 rounded-lg overflow-hidden border border-amber-100 dark:border-amber-800/30"
                >
                  {/* Main item row */}
                  <div className="flex items-center p-3">
                    {/* Expand Arrow */}
                    <button
                      onClick={() => toggleItemExpansion(purchaseRowKey(item))}
                      className="w-5 h-5 rounded-full bg-amber-100 dark:bg-amber-800/30 flex items-center justify-center hover:bg-amber-200 dark:hover:bg-amber-700/50 transition-all mr-2"
                    >
                      <ChevronRight
                        size={14}
                        className={`text-amber-600 dark:text-amber-400 transform transition-transform ${
                          expandedItems.has(purchaseRowKey(item)) ? "rotate-90" : ""
                        }`}
                      />
                    </button>

                    {/* Product Image */}
                    {item.image && (
                      <img
                        src={item.image}
                        alt={item.name}
                        className="w-12 h-12 rounded-lg object-cover"
                        crossOrigin="anonymous"
                      />
                    )}

                    {/* Product Info */}
                    <div className="flex-1 min-w-0 px-3">
                      <div className="flex items-start justify-between gap-1">
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-gray-900 dark:text-white text-sm leading-snug line-clamp-2">
                            {item.name}
                          </h4>
                          <p className="text-[11px] text-gray-400 dark:text-gray-500 capitalize mt-0.5">
                            {item.category}
                          </p>
                        </div>
                        <PurchaseHistoryInfoButton
                          itemCode={item.item_code}
                          itemName={item.name}
                          className="ml-1 flex-shrink-0"
                        />
                      </div>
                      <div className="text-sm text-amber-600 dark:text-amber-400 font-semibold mt-0.5">
                        {currency_symbol}
                        {formatGroupedAmount(item.purchase_price)}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span
                          className={`text-[10px] uppercase tracking-wide ${
                            item.supplier?.id
                              ? "text-gray-500 dark:text-gray-400"
                              : "text-amber-700 dark:text-amber-300 font-semibold"
                          }`}
                        >
                          Supplier
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSupplierPickerLineId((cur) =>
                              cur === purchaseRowKey(item) ? null : purchaseRowKey(item)
                            );
                            if (supplierPickerLineId !== purchaseRowKey(item)) {
                              setPickerSearch("");
                              searchPickerSuppliers("");
                            }
                          }}
                          className={`text-xs max-w-[140px] truncate px-2 py-0.5 rounded border ${
                            item.supplier?.id
                              ? "border-gray-200 dark:border-gray-600 text-gray-800 dark:text-gray-200"
                              : "border-amber-400 dark:border-amber-600 text-amber-800 dark:text-amber-200"
                          }`}
                          title="Choose supplier"
                        >
                          {item.supplier?.supplier_name || "Choose…"}
                        </button>
                        <button
                          type="button"
                          title="Last bought supplier"
                          disabled={lastSupplierLoadingId === purchaseRowKey(item)}
                          onClick={(e) => {
                            e.stopPropagation();
                            void applyLastBoughtSupplier(purchaseRowKey(item), item.item_code);
                          }}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-500 disabled:opacity-50"
                        >
                          {lastSupplierLoadingId === purchaseRowKey(item) ? "…" : "Last"}
                        </button>
                        <button
                          type="button"
                          title="Copy supplier from line above"
                          disabled={!aboveHasSupplier}
                          onClick={(e) => {
                            e.stopPropagation();
                            copySupplierFromAbove(purchaseRowKey(item));
                          }}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-500 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-0.5"
                        >
                          <ArrowUp size={10} />
                          Above
                        </button>
                      </div>
                      {supplierPickerLineId === purchaseRowKey(item) && (
                        <div
                          className="mt-2 p-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-white dark:bg-gray-800 z-20"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="relative mb-2">
                            <Search
                              size={12}
                              className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400"
                            />
                            <input
                              type="text"
                              value={pickerSearch}
                              onChange={(e) => setPickerSearch(e.target.value)}
                              placeholder="Search supplier…"
                              className="w-full pl-7 pr-2 py-1 text-xs border rounded border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700"
                            />
                          </div>
                          <div className="max-h-32 overflow-y-auto space-y-0.5">
                            {pickerLoading ? (
                              <p className="text-xs text-gray-500 p-1">Loading…</p>
                            ) : pickerSuppliers.length === 0 ? (
                              <p className="text-xs text-gray-500 p-1">No suppliers</p>
                            ) : (
                              pickerSuppliers.map((s) => (
                                <button
                                  key={s.id}
                                  type="button"
                                  onClick={() => assignSupplierToLine(purchaseRowKey(item), s)}
                                  className="w-full text-left text-xs px-2 py-1 rounded hover:bg-amber-50 dark:hover:bg-amber-900/30 truncate"
                                >
                                  {s.supplier_name}
                                </button>
                              ))
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Quantity Controls */}
                    <div className="flex items-center space-x-1">
                      <button
                        onClick={() => onUpdateQuantity(purchaseRowKey(item), item.quantity - 1)}
                        className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-600 flex items-center justify-center hover:bg-gray-300 dark:hover:bg-gray-500"
                      >
                        <Minus size={14} className="text-gray-600 dark:text-gray-300" />
                      </button>
                      <span className="w-8 text-center font-semibold text-gray-900 dark:text-white text-sm">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => onUpdateQuantity(purchaseRowKey(item), item.quantity + 1)}
                        className="w-6 h-6 rounded-full bg-amber-100 dark:bg-amber-800/50 flex items-center justify-center hover:bg-amber-200 dark:hover:bg-amber-700"
                      >
                        <Plus size={14} className="text-amber-600 dark:text-amber-400" />
                      </button>
                    </div>

                    {/* Total */}
                    <div className="text-right min-w-[70px] px-2">
                      <p className="text-amber-600 dark:text-amber-400 font-semibold text-sm">
                        {currency_symbol}
                        {formatGroupedAmount(itemTotal)}
                      </p>
                    </div>

                    {/* Remove */}
                    <button
                      onClick={() =>
                        onRemoveItem
                          ? onRemoveItem(purchaseRowKey(item))
                          : onUpdateQuantity(purchaseRowKey(item), 0)
                      }
                      className="w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-400 flex items-center justify-center hover:bg-red-50 hover:text-red-500"
                    >
                      <X size={12} />
                    </button>
                  </div>

                  {/* Expanded Details - Purchase & Selling Price Editors */}
                  {expandedItems.has(purchaseRowKey(item)) && (
                    <div className="border-t border-amber-100 dark:border-amber-800/30 px-3 py-3 bg-white dark:bg-gray-800/50">
                      {/* Price Editors Row */}
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <PriceInput
                          value={item.purchase_price}
                          onChange={(price) => updatePurchasePrice(purchaseRowKey(item), price)}
                          label="Buy"
                          currencySymbol={currency_symbol}
                        />
                        <PriceInput
                          value={item.selling_price}
                          onChange={(price) => updateSellingPrice(purchaseRowKey(item), price)}
                          label="Sell"
                          currencySymbol={currency_symbol}
                        />
                      </div>

                      {/* Quantity and UOM Row */}
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div>
                          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                            Quantity
                          </label>
                          <input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) =>
                              onUpdateQuantity(purchaseRowKey(item), parseInt(e.target.value) || 1)
                            }
                            className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded focus:ring-1 focus:ring-amber-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                            UOM
                          </label>
                          <input
                            type="text"
                            value={item.uom || "Nos"}
                            readOnly
                            className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
                          />
                        </div>
                      </div>

                      <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                        For batch- and expiry-tracked items, a batch is created when you complete purchase.
                        Set an expiry date below for this receipt, or leave it blank to use the item&apos;s
                        shelf life from the item master.
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                            Batch (optional)
                          </label>
                          <input
                            type="text"
                            value={item.batch || ""}
                            onChange={(e) => updateBatch(purchaseRowKey(item), e.target.value)}
                            placeholder="Leave empty for auto"
                            className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded focus:ring-1 focus:ring-amber-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                            Expiry (this receipt)
                          </label>
                          <input
                            type="date"
                            value={item.batch_expiry_date || ""}
                            onChange={(e) =>
                              updateBatchExpiryDate(purchaseRowKey(item), e.target.value)
                            }
                            className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded focus:ring-1 focus:ring-amber-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                            Serial No
                          </label>
                          <input
                            type="text"
                            value={item.serial || ""}
                            onChange={(e) => updateSerial(purchaseRowKey(item), e.target.value)}
                            placeholder="Enter serial"
                            className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded focus:ring-1 focus:ring-amber-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                          />
                        </div>
                      </div>

                      {/* Price Change Indicator */}
                      {(item.purchase_price !== item.original_purchase_price ||
                        item.selling_price !== item.original_selling_price) && (
                        <div className="mt-3 p-2 bg-amber-50 dark:bg-amber-900/20 rounded border border-amber-200 dark:border-amber-700">
                          <p className="text-xs text-amber-700 dark:text-amber-300 font-medium">
                            ⚡ Prices will be updated in the system after purchase
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Summary and Actions */}
      {cartItems.length > 0 && (
        <div className="p-4 border-t border-gray-100 dark:border-gray-700 space-y-3">
          {/* Subtotal */}
          <div className="flex justify-between text-sm">
            <span className="text-gray-600 dark:text-gray-400">Subtotal</span>
            <span className="font-semibold text-gray-900 dark:text-white">
              {currency_symbol}
              {formatGroupedAmount(subtotal)}
            </span>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={handleClearCart}
              className="px-3 py-2 border border-red-500 text-red-600 dark:text-red-400 rounded-lg font-medium hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-sm"
            >
              Clear Cart
            </button>
            <button
              onClick={() => {
                if (validateForCheckout()) {
                  setShowPaymentDialog(true);
                }
              }}
              disabled={cartItems.some((it) => !it.supplier?.id)}
              className={`px-3 py-2 rounded-lg font-medium transition-colors text-sm ${
                !cartItems.some((it) => !it.supplier?.id)
                  ? "bg-amber-600 text-white hover:bg-amber-700"
                  : "bg-gray-300 text-gray-500 cursor-not-allowed"
              }`}
            >
              Checkout
            </button>
          </div>

          {/* Total Pay Button */}
          <button
            onClick={() => {
              if (validateForCheckout()) {
                setShowPaymentDialog(true);
              }
            }}
            disabled={cartItems.some((it) => !it.supplier?.id)}
            className={`w-full py-3 rounded-xl font-semibold transition-colors ${
              !cartItems.some((it) => !it.supplier?.id)
                ? "bg-amber-600 text-white hover:bg-amber-700"
                : "bg-gray-300 text-gray-500 cursor-not-allowed"
            }`}
          >
            Complete Purchase {currency_symbol}
            {formatGroupedAmount(subtotal)}
          </button>
        </div>
      )}

      {/* Add Supplier Modal */}
      {showAddSupplierModal && (
        <AddSupplierModal
          onClose={() => setShowAddSupplierModal(false)}
          onSave={handleSaveSupplier}
        />
      )}

      {/* Payment Dialog */}
      {showPaymentDialog && (
        <PurchasePaymentDialog
          isOpen={showPaymentDialog}
          onClose={() => setShowPaymentDialog(false)}
          cartItems={cartItems}
          onCompletePayment={handleCompletePayment}
          isMobile={isMobile}
        />
      )}
    </div>
  );
}
