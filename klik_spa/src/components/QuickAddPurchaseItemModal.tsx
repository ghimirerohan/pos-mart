"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import {
  X,
  Plus,
  Minus,
  Barcode,
  ImagePlus,
  Loader2,
  AlertCircle,
  Trash2,
  Camera,
  Globe,
  CheckCircle,
  Search,
  Sparkles,
  WifiOff,
  Package,
  CreditCard,
  Truck,
  UserPlus,
} from "lucide-react"
import { toast } from "react-toastify"
import type { PurchaseCartItem, Supplier } from "../types/supplier"
import AddSupplierModal from "./AddSupplierModal"
import { formatGroupedAmount } from "../utils/currency"

// ------------------------------------------------------------------
// Image helpers (same logic as ItemsPage)
// ------------------------------------------------------------------
const MAX_IMAGE_SIZE = 800
const IMAGE_QUALITY = 0.8

const optimizeImage = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement("canvas")
        let { width, height } = img
        if (width > height) {
          if (width > MAX_IMAGE_SIZE) {
            height = Math.round((height * MAX_IMAGE_SIZE) / width)
            width = MAX_IMAGE_SIZE
          }
        } else {
          if (height > MAX_IMAGE_SIZE) {
            width = Math.round((width * MAX_IMAGE_SIZE) / height)
            height = MAX_IMAGE_SIZE
          }
        }
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext("2d")
        if (!ctx) return reject(new Error("canvas"))
        ctx.fillStyle = "#FFFFFF"
        ctx.fillRect(0, 0, width, height)
        ctx.drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL("image/jpeg", IMAGE_QUALITY))
      }
      img.onerror = () => reject(new Error("image"))
      img.src = e.target?.result as string
    }
    reader.onerror = () => reject(new Error("reader"))
    reader.readAsDataURL(file)
  })

const fetchAndOptimizeImage = async (url: string): Promise<string | null> => {
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    const blob = await r.blob()
    return optimizeImage(new File([blob], "img.jpg", { type: blob.type }))
  } catch {
    return null
  }
}

// ------------------------------------------------------------------
// Barcode lookup (Open Food Facts + UPC Item DB)
// ------------------------------------------------------------------
interface ProductInfo {
  name: string
  image_url: string | null
  brand: string | null
}

const lookupBarcode = async (barcode: string): Promise<ProductInfo | null> => {
  try {
    const off = await fetch(
      `https://world.openfoodfacts.org/api/v0/product/${barcode}.json`,
      { signal: AbortSignal.timeout(5000) }
    )
    if (off.ok) {
      const d = await off.json()
      if (d.status === 1 && d.product) {
        return {
          name: d.product.product_name || d.product.product_name_en || "",
          image_url: d.product.image_url || d.product.image_front_url || null,
          brand: d.product.brands || null,
        }
      }
    }
    try {
      const upc = await fetch(
        `https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`,
        { signal: AbortSignal.timeout(5000) }
      )
      if (upc.ok) {
        const u = await upc.json()
        if (u.items?.[0]) {
          return {
            name: u.items[0].title || "",
            image_url: u.items[0].images?.[0] || null,
            brand: u.items[0].brand || null,
          }
        }
      }
    } catch { /* fallback failed */ }
    return null
  } catch {
    return null
  }
}

// ------------------------------------------------------------------
// Constants
// ------------------------------------------------------------------
const commonUOMs = ["Nos", "Kg", "Gram", "Liter", "ML", "Box", "Pack", "Dozen", "Piece", "Unit"]
const itemGroups = ["Products", "Services", "Raw Materials", "Consumables", "Sub Assemblies"]

// ------------------------------------------------------------------
// Props
// ------------------------------------------------------------------
interface QuickAddPurchaseItemModalProps {
  isOpen: boolean
  onClose: () => void
  onItemCreated: (item: Omit<PurchaseCartItem, "quantity">, quantity: number) => void
  refetchProducts: () => Promise<void>
  currencySymbol?: string
}

// ------------------------------------------------------------------
// Component
// ------------------------------------------------------------------
export default function QuickAddPurchaseItemModal({
  isOpen,
  onClose,
  onItemCreated,
  refetchProducts,
  currencySymbol = "₨",
}: QuickAddPurchaseItemModalProps) {
  // ----- form state -----
  const [barcodeAuto, setBarcodeAuto] = useState(false)
  const [barcode, setBarcode] = useState("")
  const [barcodeError, setBarcodeError] = useState<string | null>(null)
  const [barcodeLookupStatus, setBarcodeLookupStatus] = useState<"idle" | "searching" | "found" | "not_found" | "error">("idle")
  const [isLookingUp, setIsLookingUp] = useState(false)

  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [isOptimizingImage, setIsOptimizingImage] = useState(false)

  const [itemName, setItemName] = useState("")
  const [itemCode, setItemCode] = useState("")
  const [itemCodeAuto, setItemCodeAuto] = useState(true)
  const [itemGroup, setItemGroup] = useState("Products")
  const [uom, setUom] = useState("Nos")

  const [buyingPrice, setBuyingPrice] = useState<number>(0)
  const [sellingPrice, setSellingPrice] = useState<number>(0)

  // ----- purchase-specific -----
  const [quantity, setQuantity] = useState<number>(1)

  /** Match Items page: batch + expiry on the item master for purchase stock */
  const [hasBatch, setHasBatch] = useState(true)
  const [batchAuto, setBatchAuto] = useState(true)
  const [batchNumber, setBatchNumber] = useState("")
  const [expiryType, setExpiryType] = useState<"months" | "date">("months")
  const [shelfLifeMonths, setShelfLifeMonths] = useState(3)
  const [bestBefore, setBestBefore] = useState("")

  // supplier
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [supplierSearch, setSupplierSearch] = useState("")
  const [showSupplierDropdown, setShowSupplierDropdown] = useState(false)
  const [loadingSuppliers, setLoadingSuppliers] = useState(false)
  const [showAddSupplierModal, setShowAddSupplierModal] = useState(false)
  const supplierRef = useRef<HTMLDivElement>(null)

  // payment mode
  const [paymentModes, setPaymentModes] = useState<{ mode_of_payment: string }[]>([])
  const [selectedPaymentMode, setSelectedPaymentMode] = useState("")
  const [loadingPaymentModes, setLoadingPaymentModes] = useState(false)

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitStep, setSubmitStep] = useState("")

  // ========== Data fetching ==========

  // Fetch payment modes on open
  useEffect(() => {
    if (!isOpen) return
    const fetchModes = async () => {
      setLoadingPaymentModes(true)
      try {
        const res = await fetch("/api/method/klik_pos.api.payment.get_payment_modes", {
          credentials: "include",
        })
        const data = await res.json()
        if (data.message?.success) {
          const modes = data.message.data || []
          setPaymentModes(modes)
          if (modes.length > 0) {
            // default to first mode or Cash if exists
            const cash = modes.find((m: { mode_of_payment: string }) =>
              m.mode_of_payment.toLowerCase().includes("cash")
            )
            setSelectedPaymentMode(cash?.mode_of_payment || modes[0].mode_of_payment)
          }
        }
      } catch (err) {
        console.error("Failed to load payment modes:", err)
      } finally {
        setLoadingPaymentModes(false)
      }
    }
    fetchModes()
  }, [isOpen])

  // Supplier search with debounce
  const searchSuppliers = useCallback(async (search: string) => {
    setLoadingSuppliers(true)
    try {
      const res = await fetch(
        `/api/method/klik_pos.api.supplier.get_suppliers?search=${encodeURIComponent(search)}&limit=20`,
        { method: "GET", credentials: "include" }
      )
      const data = await res.json()
      if (data.message?.success) setSuppliers(data.message.data || [])
    } catch (err) {
      console.error("Error searching suppliers:", err)
    } finally {
      setLoadingSuppliers(false)
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return
    const t = setTimeout(() => searchSuppliers(supplierSearch), 300)
    return () => clearTimeout(t)
  }, [supplierSearch, searchSuppliers, isOpen])

  // Close supplier dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (supplierRef.current && !supplierRef.current.contains(e.target as Node)) {
        setShowSupplierDropdown(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  // ========== Barcode handlers ==========

  const handleBarcodeChange = useCallback(async (val: string) => {
    setBarcode(val)
    setBarcodeError(null)
    setBarcodeLookupStatus("idle")

    if (!val) return
    // check barcode exists
    try {
      const res = await fetch("/api/method/klik_pos.api.item.check_barcode_exists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ barcode: val }),
        credentials: "include",
      })
      const data = await res.json()
      if (data.message?.exists) {
        setBarcodeError(`Barcode already used by: ${data.message.item_code}`)
      }
    } catch { /* ignore */ }
  }, [])

  const handleLookupBarcode = useCallback(async () => {
    if (!barcode || barcode.length < 8 || barcodeError) return
    setIsLookingUp(true)
    setBarcodeLookupStatus("searching")
    try {
      if (!navigator.onLine) {
        setBarcodeLookupStatus("error")
        return
      }
      const info = await lookupBarcode(barcode)
      if (info?.name) {
        setBarcodeLookupStatus("found")
        setItemName(info.name)
        if (info.image_url) {
          const img = await fetchAndOptimizeImage(info.image_url)
          if (img) setImagePreview(img)
        }
        toast.success(`Found: ${info.name}${info.brand ? ` (${info.brand})` : ""}`, { autoClose: 3000 })
      } else {
        setBarcodeLookupStatus("not_found")
      }
    } catch {
      setBarcodeLookupStatus("error")
    } finally {
      setIsLookingUp(false)
    }
  }, [barcode, barcodeError])

  // ========== Image handler ==========

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setIsOptimizingImage(true)
    try {
      const optimized = await optimizeImage(file)
      setImagePreview(optimized)
    } catch {
      toast.error("Failed to process image")
    } finally {
      setIsOptimizingImage(false)
    }
  }

  // ========== Supplier handler ==========

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
    }
    setSelectedSupplier(newSupplier)
    setShowAddSupplierModal(false)
  }

  // ========== Reset ==========

  const resetForm = () => {
    setBarcodeAuto(false)
    setBarcode("")
    setBarcodeError(null)
    setBarcodeLookupStatus("idle")
    setIsLookingUp(false)
    setImagePreview(null)
    setItemName("")
    setItemCode("")
    setItemCodeAuto(true)
    setItemGroup("Products")
    setUom("Nos")
    setBuyingPrice(0)
    setSellingPrice(0)
    setQuantity(1)
    setHasBatch(true)
    setBatchAuto(true)
    setBatchNumber("")
    setExpiryType("months")
    setShelfLifeMonths(3)
    setBestBefore("")
    setSelectedSupplier(null)
    setSupplierSearch("")
    setSelectedPaymentMode(paymentModes[0]?.mode_of_payment || "")
    setSubmitStep("")
  }

  // ========== Submit ==========

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Validation
    if (!itemName.trim()) return toast.error("Item name is required")
    if (barcodeError) return toast.error("Fix the barcode error first")
    if (buyingPrice <= 0) return toast.error("Buying price is required")
    if (sellingPrice <= 0) return toast.error("Selling price is required")
    if (!selectedSupplier) return toast.error("Supplier is required")
    if (quantity < 1) return toast.error("Quantity must be at least 1")
    if (!selectedPaymentMode) return toast.error("Payment mode is required")

    if (sellingPrice < buyingPrice) {
      toast.warning("Selling price is less than buying price")
    }

    if (hasBatch) {
      if (expiryType === "months" && (!shelfLifeMonths || shelfLifeMonths <= 0)) {
        return toast.error("Batch-tracked items need shelf life (months) or a best-before date")
      }
      if (expiryType === "date" && !bestBefore.trim()) {
        return toast.error("Enter a best-before date for batch-tracked items")
      }
    }

    setIsSubmitting(true)

    try {
      let shelfLifeDays = 0
      let expiryDate: string | undefined
      if (hasBatch) {
        if (expiryType === "months" && shelfLifeMonths > 0) {
          shelfLifeDays = shelfLifeMonths * 30
          const expiry = new Date()
          expiry.setDate(expiry.getDate() + shelfLifeDays)
          expiryDate = expiry.toISOString().split("T")[0]
        } else if (expiryType === "date" && bestBefore) {
          const today = new Date()
          const expiry = new Date(bestBefore)
          shelfLifeDays = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
          if (shelfLifeDays < 0) shelfLifeDays = 0
          expiryDate = bestBefore
        }
      }

      let manualBatch = batchNumber
      if (hasBatch && batchAuto) {
        manualBatch = ""
      }

      // --- Step 1: Create item ---
      setSubmitStep("Creating item...")
      const barcodeValue = barcodeAuto ? undefined : barcode || undefined
      const createRes = await fetch("/api/method/klik_pos.api.item.create_item_with_barcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_name: itemName,
          item_code: itemCodeAuto ? undefined : itemCode || undefined,
          item_group: itemGroup,
          stock_uom: uom,
          barcode: barcodeValue,
          use_item_code_as_barcode: barcodeAuto ? 1 : 0,
          has_batch_no: hasBatch ? 1 : 0,
          has_expiry_date: hasBatch ? 1 : 0,
          shelf_life_in_days: shelfLifeDays > 0 ? shelfLifeDays : undefined,
          batch_no: hasBatch && !batchAuto && manualBatch ? manualBatch : undefined,
          expiry_date: expiryDate,
          selling_price: sellingPrice,
          buying_price: buyingPrice,
          opening_stock: 0,
          image_data: imagePreview || undefined,
        }),
        credentials: "include",
      })
      const createResult = await createRes.json()

      if (createResult.exc || createResult.exception || createResult._server_messages) {
        let msg = "Failed to create item"
        if (createResult._server_messages) {
          try {
            const msgs = JSON.parse(createResult._server_messages)
            const parsed = JSON.parse(msgs[0])
            msg = parsed.message || msg
          } catch { /* use default */ }
        }
        throw new Error(msg)
      }

      const newItemCode = createResult.message?.item_code
      if (!newItemCode) throw new Error("Item created but no item_code returned")

      toast.success(`Item "${itemName}" created`, { autoClose: 2000 })

      // --- Step 2: Create purchase invoice ---
      setSubmitStep("Creating purchase invoice...")
      const purchaseData = {
        supplier: { id: selectedSupplier.id },
        items: [
          {
            id: newItemCode,
            quantity,
            purchase_price: buyingPrice,
            selling_price: sellingPrice,
            original_purchase_price: buyingPrice,
            original_selling_price: sellingPrice,
            uom,
            batch: hasBatch && !batchAuto && manualBatch ? manualBatch : undefined,
            expiry_date: hasBatch ? expiryDate : undefined,
            batch_expiry_date: hasBatch ? expiryDate : undefined,
          },
        ],
        paymentMethods: [
          {
            mode_of_payment: selectedPaymentMode,
            amount: quantity * buyingPrice,
          },
        ],
        isCreditPurchase: false,
      }

      const purchRes = await fetch("/api/method/klik_pos.api.purchase_invoice.create_purchase_invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: JSON.stringify(purchaseData) }),
        credentials: "include",
      })
      const purchResult = await purchRes.json()

      if (purchResult.exc || purchResult.exception) {
        let msg = "Item created, but purchase invoice failed."
        if (purchResult._server_messages) {
          try {
            const msgs = JSON.parse(purchResult._server_messages)
            const parsed = JSON.parse(msgs[0])
            msg += " " + (parsed.message || "")
          } catch { /* use default */ }
        }
        toast.error(msg, { autoClose: 5000 })
        // Still refresh products since the item was created
        await refetchProducts()
        setIsSubmitting(false)
        setSubmitStep("")
        return
      }

      toast.success("Purchase invoice created & stock updated", { autoClose: 2000 })

      // --- Step 3: Refresh products ---
      setSubmitStep("Refreshing products...")
      await refetchProducts()

      // --- Step 4: Add to cart ---
      const cartItem: Omit<PurchaseCartItem, "quantity"> = {
        id: newItemCode,
        item_code: newItemCode,
        name: itemName,
        category: itemGroup,
        image: createResult.message?.image || "",
        uom,
        purchase_price: buyingPrice,
        selling_price: sellingPrice,
        original_purchase_price: buyingPrice,
        original_selling_price: sellingPrice,
        currency_symbol: currencySymbol,
        has_batch_no: hasBatch ? 1 : 0,
        has_expiry_date: hasBatch ? 1 : 0,
        shelf_life_in_days: shelfLifeDays > 0 ? shelfLifeDays : null,
      }
      onItemCreated(cartItem, quantity)

      toast.success(`${itemName} added to purchase cart (qty: ${quantity})`, { autoClose: 2000 })

      resetForm()
      onClose()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong"
      toast.error(message, { autoClose: 5000 })
    } finally {
      setIsSubmitting(false)
      setSubmitStep("")
    }
  }

  if (!isOpen) return null

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center overflow-y-auto py-4 px-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg my-4 relative">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-amber-500 to-orange-500 rounded-t-xl">
            <div className="flex items-center gap-2 text-white">
              <Package size={22} />
              <h2 className="text-lg font-bold">Quick Add &amp; Purchase Item</h2>
            </div>
            <button
              onClick={() => { resetForm(); onClose() }}
              className="text-white/80 hover:text-white transition-colors"
            >
              <X size={22} />
            </button>
          </div>

          {/* Body (scrollable) */}
          <form onSubmit={handleSubmit} className="overflow-y-auto max-h-[calc(100vh-160px)] px-5 py-4 space-y-5">
            {/* ---- Barcode ---- */}
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                <Barcode size={16} className="text-amber-600" />
                Barcode
              </h3>
              <label className="flex items-center space-x-2 mb-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={barcodeAuto}
                  onChange={(e) => {
                    setBarcodeAuto(e.target.checked)
                    setBarcode("")
                    setBarcodeError(null)
                    setBarcodeLookupStatus("idle")
                  }}
                  className="w-4 h-4 text-amber-600 rounded"
                />
                <span className="text-xs text-gray-600 dark:text-gray-400">Auto Generate (unique SKU barcode)</span>
              </label>
              {!barcodeAuto && (
                <>
                  <div className="flex space-x-2">
                    <div className="flex-1 relative">
                      <input
                        type="text"
                        value={barcode}
                        onChange={(e) => handleBarcodeChange(e.target.value)}
                        placeholder="Enter or scan barcode"
                        className={`w-full px-3 py-2 text-sm border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white ${
                          barcodeError ? "border-red-500" : "border-gray-300 dark:border-gray-600"
                        }`}
                      />
                      {barcodeError && (
                        <p className="text-red-500 text-xs mt-1 flex items-center">
                          <AlertCircle size={12} className="mr-1" />
                          {barcodeError}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={handleLookupBarcode}
                      disabled={isLookingUp || !barcode || barcode.length < 8 || !!barcodeError}
                      className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
                      title="Lookup product info"
                    >
                      {isLookingUp ? <Loader2 size={16} className="animate-spin text-amber-600" /> : <Globe size={16} className="text-amber-600" />}
                    </button>
                  </div>
                  {barcodeLookupStatus !== "idle" && (
                    <div className={`mt-2 text-xs flex items-center ${
                      barcodeLookupStatus === "searching" ? "text-blue-500" :
                      barcodeLookupStatus === "found" ? "text-green-500" :
                      barcodeLookupStatus === "not_found" ? "text-yellow-500" : "text-red-500"
                    }`}>
                      {barcodeLookupStatus === "searching" && <><Loader2 size={12} className="mr-1 animate-spin" /> Looking up...</>}
                      {barcodeLookupStatus === "found" && <><Sparkles size={12} className="mr-1" /> Product info found and filled!</>}
                      {barcodeLookupStatus === "not_found" && <><AlertCircle size={12} className="mr-1" /> Not found. Enter details manually.</>}
                      {barcodeLookupStatus === "error" && <><WifiOff size={12} className="mr-1" /> Could not connect.</>}
                    </div>
                  )}
                </>
              )}
              {barcodeAuto && (
                <div className="mt-1 p-2 bg-blue-50 dark:bg-blue-900/20 rounded text-xs text-blue-700 dark:text-blue-300 flex items-center gap-1">
                  <CheckCircle size={14} /> A unique EAN-13 barcode will be auto-generated.
                </div>
              )}
            </div>

            {/* ---- Item Image ---- */}
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                <ImagePlus size={16} className="text-amber-600" />
                Item Image (Optional)
              </h3>
              <div className="flex flex-col items-center">
                {imagePreview ? (
                  <div className="relative">
                    <img src={imagePreview} alt="Preview" className="w-28 h-28 object-cover rounded-lg border-2 border-gray-200 dark:border-gray-600" />
                    <button type="button" onClick={() => setImagePreview(null)} className="absolute -top-2 -right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600 shadow">
                      <Trash2 size={12} />
                    </button>
                  </div>
                ) : (
                  <label className="w-28 h-28 flex flex-col items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer hover:border-amber-500 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    {isOptimizingImage ? (
                      <Loader2 size={24} className="animate-spin text-gray-400" />
                    ) : (
                      <>
                        <ImagePlus size={24} className="text-gray-400 mb-1" />
                        <span className="text-xs text-gray-500">Upload</span>
                      </>
                    )}
                    <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" disabled={isOptimizingImage} />
                  </label>
                )}
              </div>
            </div>

            {/* ---- Basic Info ---- */}
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Basic Information</h3>
              {/* Item Name */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Item Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                  placeholder="Enter item name"
                  required
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              {/* Item Code */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Item Code</label>
                <label className="flex items-center space-x-2 cursor-pointer mb-1">
                  <input type="checkbox" checked={itemCodeAuto} onChange={(e) => setItemCodeAuto(e.target.checked)} className="w-4 h-4 text-amber-600 rounded" />
                  <span className="text-xs text-gray-600 dark:text-gray-400">Auto Generate</span>
                </label>
                {!itemCodeAuto && (
                  <input
                    type="text"
                    value={itemCode}
                    onChange={(e) => setItemCode(e.target.value)}
                    placeholder="Enter item code"
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                )}
              </div>
              {/* Item Group + UOM (side by side) */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Item Group</label>
                  <select
                    value={itemGroup}
                    onChange={(e) => setItemGroup(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    {itemGroups.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">UOM</label>
                  <select
                    value={uom}
                    onChange={(e) => setUom(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    {commonUOMs.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* ---- Batch & expiry (item master + purchase batch) ---- */}
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Package size={16} className="text-amber-600" />
                Batch &amp; expiry
              </h3>
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hasBatch}
                  onChange={(e) => setHasBatch(e.target.checked)}
                  className="w-4 h-4 text-amber-600 rounded"
                />
                <span className="text-xs text-gray-700 dark:text-gray-300">Track batch and expiry</span>
              </label>
              {hasBatch && (
                <div className="space-y-3 pl-1 border-l-2 border-amber-200 dark:border-amber-800 ml-1">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={batchAuto}
                      onChange={(e) => {
                        setBatchAuto(e.target.checked)
                        if (e.target.checked) setBatchNumber("")
                      }}
                      className="w-4 h-4 text-amber-600 rounded"
                    />
                    <span className="text-xs text-gray-600 dark:text-gray-400">Auto-generate batch on receipt</span>
                  </label>
                  {!batchAuto && (
                    <input
                      type="text"
                      value={batchNumber}
                      onChange={(e) => setBatchNumber(e.target.value)}
                      placeholder="Batch number"
                      className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  )}
                  <div>
                    <span className="block text-xs text-gray-600 dark:text-gray-400 mb-2">Shelf life / expiry</span>
                    <div className="flex gap-4 mb-2">
                      <label className="flex items-center gap-1.5 text-xs cursor-pointer text-gray-700 dark:text-gray-300">
                        <input
                          type="radio"
                          name="qaExpiryType"
                          checked={expiryType === "months"}
                          onChange={() => {
                            setExpiryType("months")
                            setBestBefore("")
                          }}
                          className="text-amber-600"
                        />
                        Months
                      </label>
                      <label className="flex items-center gap-1.5 text-xs cursor-pointer text-gray-700 dark:text-gray-300">
                        <input
                          type="radio"
                          name="qaExpiryType"
                          checked={expiryType === "date"}
                          onChange={() => {
                            setExpiryType("date")
                            setShelfLifeMonths(0)
                          }}
                          className="text-amber-600"
                        />
                        Date
                      </label>
                    </div>
                    {expiryType === "months" ? (
                      <input
                        type="number"
                        min={1}
                        value={shelfLifeMonths || ""}
                        onChange={(e) => setShelfLifeMonths(parseInt(e.target.value, 10) || 0)}
                        placeholder="Months"
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    ) : (
                      <input
                        type="date"
                        value={bestBefore}
                        onChange={(e) => setBestBefore(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ---- Pricing ---- */}
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Pricing</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Buying Price <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    value={buyingPrice || ""}
                    onChange={(e) => setBuyingPrice(parseFloat(e.target.value) || 0)}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Selling Price <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    value={sellingPrice || ""}
                    onChange={(e) => setSellingPrice(parseFloat(e.target.value) || 0)}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
              </div>
              {sellingPrice > 0 && buyingPrice > 0 && (
                <p className={`text-xs ${sellingPrice >= buyingPrice ? "text-green-600" : "text-red-600"}`}>
                  Margin: {(((sellingPrice - buyingPrice) / buyingPrice) * 100).toFixed(1)}%
                </p>
              )}
            </div>

            {/* ---- Purchase Details ---- */}
            <div className="border border-amber-200 dark:border-amber-800/30 rounded-lg p-4 space-y-3 bg-amber-50/50 dark:bg-amber-900/10">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Truck size={16} className="text-amber-600" />
                Purchase Details
              </h3>

              {/* Supplier */}
              <div ref={supplierRef} className="relative">
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Supplier <span className="text-red-500">*</span>
                </label>
                {selectedSupplier ? (
                  <div className="flex items-center justify-between px-3 py-2 border border-amber-300 dark:border-amber-700 rounded-lg bg-white dark:bg-gray-700">
                    <span className="text-sm text-gray-900 dark:text-white">{selectedSupplier.supplier_name || selectedSupplier.name}</span>
                    <button type="button" onClick={() => setSelectedSupplier(null)} className="text-gray-400 hover:text-red-500">
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      value={supplierSearch}
                      onChange={(e) => { setSupplierSearch(e.target.value); setShowSupplierDropdown(true) }}
                      onFocus={() => setShowSupplierDropdown(true)}
                      placeholder="Search supplier..."
                      className="w-full pl-9 pr-10 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                    <button
                      type="button"
                      onClick={() => setShowAddSupplierModal(true)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-amber-600 hover:text-amber-700"
                      title="Add new supplier"
                    >
                      <UserPlus size={16} />
                    </button>
                  </div>
                )}
                {showSupplierDropdown && !selectedSupplier && (
                  <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                    {loadingSuppliers ? (
                      <div className="p-3 text-center text-sm text-gray-500"><Loader2 size={16} className="inline animate-spin mr-1" /> Loading...</div>
                    ) : suppliers.length === 0 ? (
                      <div className="p-3 text-center text-sm text-gray-500">No suppliers found</div>
                    ) : (
                      suppliers.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => { setSelectedSupplier(s); setShowSupplierDropdown(false); setSupplierSearch("") }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-amber-50 dark:hover:bg-gray-600 text-gray-900 dark:text-white"
                        >
                          {s.supplier_name || s.name}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Quantity */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Quantity <span className="text-red-500">*</span>
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                    className="p-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600"
                  >
                    <Minus size={16} />
                  </button>
                  <input
                    type="number"
                    value={quantity}
                    onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                    min="1"
                    className="w-20 text-center px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() => setQuantity(quantity + 1)}
                    className="p-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>

              {/* Payment Mode */}
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Payment Mode <span className="text-red-500">*</span>
                </label>
                {loadingPaymentModes ? (
                  <div className="text-sm text-gray-500 flex items-center gap-1"><Loader2 size={14} className="animate-spin" /> Loading...</div>
                ) : (
                  <select
                    value={selectedPaymentMode}
                    onChange={(e) => setSelectedPaymentMode(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    <option value="">Select payment mode</option>
                    {paymentModes.map((m) => (
                      <option key={m.mode_of_payment} value={m.mode_of_payment}>{m.mode_of_payment}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Total */}
              {buyingPrice > 0 && quantity > 0 && (
                <div className="flex items-center justify-between pt-2 border-t border-amber-200 dark:border-amber-800/30">
                  <span className="text-xs text-gray-600 dark:text-gray-400">Purchase Total</span>
                  <span className="text-sm font-bold text-gray-900 dark:text-white">
                    {currencySymbol} {formatGroupedAmount(buyingPrice * quantity)}
                  </span>
                </div>
              )}
            </div>

            {/* ---- Submit ---- */}
            <button
              type="submit"
              disabled={isSubmitting || !!barcodeError}
              className={`w-full py-3 rounded-lg font-semibold text-white flex items-center justify-center gap-2 transition-colors ${
                isSubmitting || barcodeError
                  ? "bg-gray-400 cursor-not-allowed"
                  : "bg-amber-500 hover:bg-amber-600"
              }`}
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  <span>{submitStep || "Processing..."}</span>
                </>
              ) : (
                <>
                  <CreditCard size={18} />
                  <span>Create Item &amp; Purchase</span>
                </>
              )}
            </button>
          </form>
        </div>
      </div>

      {/* Add Supplier Modal */}
      {showAddSupplierModal && (
        <AddSupplierModal
          isOpen={showAddSupplierModal}
          onClose={() => setShowAddSupplierModal(false)}
          onSave={handleSaveSupplier}
        />
      )}
    </>
  )
}
