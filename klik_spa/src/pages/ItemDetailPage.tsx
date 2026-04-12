"use client"

import { useState, useEffect, useCallback } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { 
  ArrowLeft,
  Edit2,
  Save,
  Package,
  Barcode,
  DollarSign,
  Box,
  Calendar,
  ImagePlus,
  Trash2,
  Loader2,
  X,
  Printer,
  Download,
  Ban,
  CheckCircle,
  ChevronRight,
  ExternalLink
} from "lucide-react"
import { useAuth } from "../hooks/useAuth"
import BottomNavigation from "../components/BottomNavigation"
import BarcodePrintDialog from "../components/BarcodePrintDialog"
import { toast } from "react-toastify"
import { formatCurrency, formatGroupedAmount } from "../utils/currency"
import { frappeJsonPostInit } from "../utils/csrf"

/** Shape of Item from frappe.client.get (fields we use). */
interface FrappeItemDoc {
  item_code: string
  item_name: string
  item_group: string
  stock_uom: string
  image: string | null
  standard_rate?: number
  valuation_rate?: number
  has_batch_no?: number
  has_expiry_date?: number
  shelf_life_in_days?: number | null
  disabled?: number
  barcodes?: { barcode?: string }[]
}

interface ItemDetails {
  item_code: string
  item_name: string
  item_group: string
  stock_uom: string
  image: string | null
  barcode: string | null
  standard_rate: number
  valuation_rate: number
  has_batch_no: number
  has_expiry_date: number
  shelf_life_in_days: number | null
  available_qty: number
  /** Same as available_qty: min(warehouse, batch total) for batch items. */
  sellable_qty: number
  warehouse_qty: number
  batch_total_qty: number
  batch_warehouse_mismatch: boolean
  warehouse: string
  disabled: number
}

const STOCK_CORRECTION_REASONS = [
  "Physical count mismatch",
  "Damage / spoilage",
  "Theft / shrinkage",
  "Data entry error",
  "System migration correction",
  "Supplier return adjustment",
  "Other",
] as const

interface EditForm {
  item_name: string
  item_group: string
  stock_uom: string
  standard_rate: number
  valuation_rate: number
  shelf_life_in_days: number | null
  barcode: string
  available_qty: number
  correction_reason: string
  correction_note: string
}

interface ItemBatchStockSummary {
  total_qty: number
  batch_count: number
  avg_days_to_expiry: number | null
  avg_buying_rate: number | null
}

interface ItemBatchDetailRow {
  batch_no: string
  batch_id: string
  qty: number
  expiry_date: string
  days_to_expiry: number | null
  purchase_invoice: string | null
  purchase_receipt?: string | null
  supplier_name: string
  pi_rate: number | null
  pi_posting_date: string
  sle_voucher_type: string | null
  sle_voucher_no: string | null
  sle_posting_date: string
  sle_incoming_rate: number | null
  source_label: string
}

interface ItemBatchStockPayload {
  warehouse: string
  currency: string
  summary: ItemBatchStockSummary
  batches: ItemBatchDetailRow[]
}

async function fetchItemBatchStockDetails(itemCode: string): Promise<ItemBatchStockPayload> {
  const res = await fetch(
    "/api/method/klik_pos.api.item.get_item_batch_stock_details",
    await frappeJsonPostInit({ item_code: itemCode })
  )
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  const message = json.message
  if (!message?.success) throw new Error(message?.error || json.exc || "Failed to load batch stock")
  return {
    warehouse: message.warehouse || "",
    currency: message.currency || "USD",
    summary: message.summary as ItemBatchStockSummary,
    batches: (message.batches || []) as ItemBatchDetailRow[],
  }
}

// Image optimization settings
const MAX_IMAGE_WIDTH = 800
const MAX_IMAGE_HEIGHT = 800
const IMAGE_QUALITY = 0.8

const optimizeImage = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let { width, height } = img
        
        if (width > height) {
          if (width > MAX_IMAGE_WIDTH) {
            height = Math.round((height * MAX_IMAGE_WIDTH) / width)
            width = MAX_IMAGE_WIDTH
          }
        } else {
          if (height > MAX_IMAGE_HEIGHT) {
            width = Math.round((width * MAX_IMAGE_HEIGHT) / height)
            height = MAX_IMAGE_HEIGHT
          }
        }
        
        canvas.width = width
        canvas.height = height
        
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Failed to get canvas context'))
          return
        }
        
        ctx.fillStyle = '#FFFFFF'
        ctx.fillRect(0, 0, width, height)
        ctx.drawImage(img, 0, 0, width, height)
        
        const optimizedDataUrl = canvas.toDataURL('image/jpeg', IMAGE_QUALITY)
        resolve(optimizedDataUrl)
      }
      img.onerror = () => reject(new Error('Failed to load image'))
      img.src = e.target?.result as string
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

const commonUOMs = ["Nos", "Kg", "Gram", "Liter", "ML", "Box", "Pack", "Dozen", "Piece", "Unit"]
const itemGroups = ["Products", "Services", "Raw Materials", "Consumables", "Sub Assemblies"]

function parseFrappeClientError(data: Record<string, unknown>): string | null {
  const toPlainText = (raw: string): string => {
    const s = raw.trim()
    if (!s) return s
    if (typeof window !== "undefined") {
      const div = document.createElement("div")
      div.innerHTML = s
      return (div.textContent || div.innerText || s).replace(/\s+/g, " ").trim()
    }
    return s
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim()
  }

  const sm = data._server_messages
  if (typeof sm === "string" && sm.trim()) {
    try {
      const arr = JSON.parse(sm) as unknown[]
      if (Array.isArray(arr) && arr.length > 0) {
        const first = arr[0]
        if (typeof first === "string") {
          try {
            const inner = JSON.parse(first) as { message?: string }
            if (inner?.message) return toPlainText(inner.message)
          } catch {
            return toPlainText(first)
          }
        }
      }
    } catch {
      /* ignore */
    }
  }
  if (typeof data.exception === "string" && data.exception.trim()) {
    const line = data.exception.split("\n")[0]
    return toPlainText(line || data.exception)
  }
  if (typeof data.exc === "string" && data.exc.trim()) {
    const line = data.exc.split("\n").pop() || data.exc
    const cleaned = toPlainText(line)
    return cleaned.length > 240 ? `${cleaned.slice(0, 240)}…` : cleaned
  }
  return null
}

/** Frappe `/api/method/*` responses sometimes stringify `message`; normalize to an object. */
function normalizeFrappeMethodMessage(message: unknown): Record<string, unknown> | null {
  if (message == null) return null
  if (typeof message === "string") {
    try {
      const parsed = JSON.parse(message) as unknown
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      return null
    }
    return null
  }
  if (typeof message === "object" && !Array.isArray(message)) {
    return message as Record<string, unknown>
  }
  return null
}

export default function ItemDetailPage() {
  const navigate = useNavigate()
  const params = useParams<{ "*": string }>()
  const rawSplat = (params["*"] ?? "").replace(/^\/+|\/+$/g, "")
  const itemCode = (() => {
    if (!rawSplat) return ""
    try {
      return decodeURIComponent(rawSplat)
    } catch {
      return rawSplat
    }
  })()
  const { user } = useAuth()

  const [item, setItem] = useState<ItemDetails | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [originalForm, setOriginalForm] = useState<EditForm | null>(null)
  const [form, setForm] = useState<EditForm>({
    item_name: '',
    item_group: '',
    stock_uom: '',
    standard_rate: 0,
    valuation_rate: 0,
    shelf_life_in_days: null,
    barcode: '',
    available_qty: 0,
    correction_reason: '',
    correction_note: '',
  })
  const [isUpdatingStock, setIsUpdatingStock] = useState(false)
  const [shelfLifeUnit, setShelfLifeUnit] = useState<"months" | "days">("months")
  const [newImage, setNewImage] = useState<string | null>(null)
  const [isOptimizingImage, setIsOptimizingImage] = useState(false)
  const [showPrintDialog, setShowPrintDialog] = useState(false)
  
  // Inactive/Disabled state (Administrator only)
  const [showInactiveConfirm, setShowInactiveConfirm] = useState(false)
  const [showActiveConfirm, setShowActiveConfirm] = useState(false)
  const [isTogglingDisabled, setIsTogglingDisabled] = useState(false)

  const [batchStock, setBatchStock] = useState<ItemBatchStockPayload | null>(null)
  const [batchStockLoading, setBatchStockLoading] = useState(false)
  const [batchStockError, setBatchStockError] = useState<string | null>(null)
  const [batchModalOpen, setBatchModalOpen] = useState(false)
  const [batchModalLoading, setBatchModalLoading] = useState(false)
  const [batchModalError, setBatchModalError] = useState<string | null>(null)
  const [editingBatchNo, setEditingBatchNo] = useState<string | null>(null)
  const [editingBatchExpiry, setEditingBatchExpiry] = useState<string>("")
  const [isSavingBatchExpiry, setIsSavingBatchExpiry] = useState(false)

  // Check if current user is Administrator
  const isAdministrator = user?.name === 'Administrator'
  const isItemDisabled = item?.disabled === 1

  // Fetch item details
  const fetchItemDetails = useCallback(async () => {
    if (!itemCode) {
      setIsLoading(false)
      setItem(null)
      setLoadError(null)
      return
    }

    setIsLoading(true)
    setItem(null)
    setLoadError(null)
    try {
      // Fetch item document
      const detailUrl = `/api/method/klik_pos.api.item.get_item_detail_for_spa?item_code=${encodeURIComponent(itemCode)}`
      const response = await fetch(detailUrl, {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
      })
      const data = (await response.json()) as Record<string, unknown>

      if (!response.ok) {
        const msg =
          parseFrappeClientError(data) ||
          (typeof data.message === "string" ? data.message : null) ||
          `Request failed (${response.status})`
        setLoadError(msg)
        return
      }

      if (data.exc) {
        setLoadError(parseFrappeClientError(data) || "Could not load item.")
        return
      }

      if (!data.message) {
        setLoadError(
          "This item code does not exist, was deleted, or you do not have permission to open it."
        )
        return
      }

      const itemDoc = data.message as FrappeItemDoc

      // Fetch barcode from child table
      let barcode = ""
      if (itemDoc.barcodes && itemDoc.barcodes.length > 0) {
        barcode = itemDoc.barcodes[0]?.barcode || ""
      }

      // Fetch stock qty
      let availableQty = 0
      let warehouse = ""
      let warehouseQty = 0
      let batchTotalQty = 0
      let sellableQty = 0
      let batchMismatch = false
      try {
        const stockResponse = await fetch(
          "/api/method/klik_pos.api.item.get_item_stock",
          await frappeJsonPostInit({ item_code: itemCode })
        )
        const stockData = await stockResponse.json()
        const sm = stockData.message as Record<string, unknown> | undefined
        availableQty = typeof sm?.available === "number" ? sm.available : Number(sm?.available) || 0
        warehouse = typeof sm?.warehouse === "string" ? sm.warehouse : ""
        warehouseQty = typeof sm?.warehouse_qty === "number" ? sm.warehouse_qty : Number(sm?.warehouse_qty) || 0
        batchTotalQty = typeof sm?.batch_total_qty === "number" ? sm.batch_total_qty : Number(sm?.batch_total_qty) || 0
        sellableQty = typeof sm?.sellable_qty === "number" ? sm.sellable_qty : Number(sm?.sellable_qty) || availableQty
        batchMismatch = Boolean(sm?.batch_warehouse_mismatch)
      } catch {
        console.error("Failed to fetch stock")
      }

      if (!warehouse) {
        try {
          const whRes = await fetch(
            "/api/method/klik_pos.api.item.get_pos_default_warehouse",
            await frappeJsonPostInit({})
          )
          const whData = await whRes.json()
          const wm = whData.message as Record<string, unknown> | undefined
          const w = typeof wm?.warehouse === "string" ? wm.warehouse.trim() : ""
          if (w) warehouse = w
        } catch {
          console.error("Failed to fetch POS default warehouse")
        }
      }

      // Fetch prices from Item Price table (single source of truth)
      let sellingPrice = 0
      let buyingPrice = 0
      try {
        const pricesResponse = await fetch(
          "/api/method/klik_pos.api.item.get_item_prices",
          await frappeJsonPostInit({ item_code: itemCode })
        )
        const pricesData = await pricesResponse.json()
        if (pricesData.message) {
          sellingPrice = pricesData.message.selling_price || 0
          buyingPrice = pricesData.message.buying_price || 0
        }
      } catch {
        console.error("Failed to fetch prices from Item Price table, using Item document fallback")
        sellingPrice = itemDoc.standard_rate || 0
        buyingPrice = itemDoc.valuation_rate || 0
      }

      const itemDetails: ItemDetails = {
        item_code: itemDoc.item_code,
        item_name: itemDoc.item_name,
        item_group: itemDoc.item_group,
        stock_uom: itemDoc.stock_uom,
        image: itemDoc.image,
        barcode: barcode,
        standard_rate: sellingPrice,
        valuation_rate: buyingPrice,
        has_batch_no: itemDoc.has_batch_no || 0,
        has_expiry_date: itemDoc.has_expiry_date || 0,
        shelf_life_in_days: itemDoc.shelf_life_in_days || null,
        available_qty: availableQty,
        sellable_qty: sellableQty,
        warehouse_qty: warehouseQty,
        batch_total_qty: batchTotalQty,
        batch_warehouse_mismatch: batchMismatch,
        warehouse: warehouse,
        disabled: itemDoc.disabled || 0,
      }

      setItem(itemDetails)

      const formData: EditForm = {
        item_name: itemDetails.item_name,
        item_group: itemDetails.item_group,
        stock_uom: itemDetails.stock_uom,
        standard_rate: itemDetails.standard_rate,
        valuation_rate: itemDetails.valuation_rate,
        shelf_life_in_days: itemDetails.shelf_life_in_days,
        barcode: itemDetails.barcode || "",
        available_qty: itemDetails.available_qty,
        correction_reason: '',
        correction_note: '',
      }
      setForm(formData)
      setOriginalForm(formData)
    } catch (err) {
      console.error("Error fetching item:", err)
      const msg = err instanceof Error ? err.message : "Failed to load item details"
      setLoadError(msg)
      toast.error("Failed to load item details")
    } finally {
      setIsLoading(false)
    }
  }, [itemCode])

  useEffect(() => {
    fetchItemDetails()
  }, [fetchItemDetails])

  // Default shelf-life editor to months whenever edit mode opens.
  useEffect(() => {
    if (isEditing) setShelfLifeUnit("months")
  }, [isEditing])

  useEffect(() => {
    if (!itemCode || !item?.has_batch_no) {
      setBatchStock(null)
      setBatchStockError(null)
      setBatchStockLoading(false)
      return
    }
    let cancelled = false
    setBatchStockLoading(true)
    setBatchStockError(null)
    fetchItemBatchStockDetails(itemCode)
      .then((d) => {
        if (!cancelled) setBatchStock(d)
      })
      .catch((e) => {
        if (!cancelled) setBatchStockError(e instanceof Error ? e.message : "Failed to load batches")
      })
      .finally(() => {
        if (!cancelled) setBatchStockLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [itemCode, item?.has_batch_no])

  const closeBatchModal = useCallback(() => {
    setBatchModalOpen(false)
    setBatchModalError(null)
    setBatchModalLoading(false)
    setEditingBatchNo(null)
    setEditingBatchExpiry("")
    setIsSavingBatchExpiry(false)
  }, [])

  const openBatchModal = useCallback(async () => {
    if (!itemCode) return
    setBatchModalOpen(true)
    setBatchModalLoading(true)
    setBatchModalError(null)
    try {
      const d = await fetchItemBatchStockDetails(itemCode)
      setBatchStock(d)
    } catch (e) {
      setBatchModalError(e instanceof Error ? e.message : "Failed to load")
    } finally {
      setBatchModalLoading(false)
    }
  }, [itemCode])

  const startEditBatchExpiry = useCallback((row: ItemBatchDetailRow) => {
    setEditingBatchNo(row.batch_no)
    setEditingBatchExpiry(row.expiry_date || "")
  }, [])

  const cancelEditBatchExpiry = useCallback(() => {
    setEditingBatchNo(null)
    setEditingBatchExpiry("")
    setIsSavingBatchExpiry(false)
  }, [])

  const saveBatchExpiry = useCallback(async () => {
    if (!itemCode || !editingBatchNo) return
    setIsSavingBatchExpiry(true)
    setBatchModalError(null)
    try {
      const response = await fetch(
        "/api/method/klik_pos.api.item.update_batch_expiry",
        await frappeJsonPostInit({
          item_code: itemCode,
          batch_no: editingBatchNo,
          expiry_date: editingBatchExpiry || null,
        })
      )
      const raw = (await response.json()) as Record<string, unknown>

      if (!response.ok) {
        const msg =
          parseFrappeClientError(raw) ||
          (typeof raw.message === "string" ? raw.message : null) ||
          `Request failed (${response.status})`
        throw new Error(msg)
      }
      if (raw.exc || raw.exception) {
        throw new Error(String(raw.exc || raw.exception || "Failed to update batch expiry"))
      }

      const msg = normalizeFrappeMethodMessage(raw.message)
      if (!msg || msg.status !== "success") {
        throw new Error(
          typeof msg?.message === "string" ? msg.message : "Failed to update batch expiry"
        )
      }

      const updated = await fetchItemBatchStockDetails(itemCode)
      setBatchStock(updated)
      toast.success(
        `Batch expiry updated${msg.batch_id ? ` (${String(msg.batch_id)})` : ""}`
      )
      setEditingBatchNo(null)
      setEditingBatchExpiry("")
    } catch (err) {
      const m = err instanceof Error ? err.message : "Failed to update batch expiry"
      setBatchModalError(m)
      toast.error(m)
    } finally {
      setIsSavingBatchExpiry(false)
    }
  }, [editingBatchExpiry, editingBatchNo, itemCode])

  useEffect(() => {
    if (!batchModalOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeBatchModal()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [batchModalOpen, closeBatchModal])

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file')
      return
    }
    
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Image is too large. Max 10MB allowed.')
      return
    }
    
    setIsOptimizingImage(true)
    
    try {
      const optimizedImage = await optimizeImage(file)
      setNewImage(optimizedImage)
      toast.success('Image uploaded')
    } catch (err) {
      console.error('Image optimization error:', err)
      toast.error('Failed to process image')
    } finally {
      setIsOptimizingImage(false)
    }
  }

  const removeNewImage = () => {
    setNewImage(null)
  }

  const hasChanges = (): boolean => {
    if (!originalForm) return false
    if (newImage) return true
    
    return (
      form.item_name !== originalForm.item_name ||
      form.item_group !== originalForm.item_group ||
      form.stock_uom !== originalForm.stock_uom ||
      form.standard_rate !== originalForm.standard_rate ||
      form.valuation_rate !== originalForm.valuation_rate ||
      form.shelf_life_in_days !== originalForm.shelf_life_in_days ||
      form.barcode !== originalForm.barcode ||
      form.available_qty !== originalForm.available_qty ||
      !!newImage
    )
  }

  const handleCancelEdit = () => {
    if (originalForm) {
      setForm(originalForm)
    }
    setShelfLifeUnit("months")
    setNewImage(null)
    setIsEditing(false)
  }

  const handleUpdate = async () => {
    if (!hasChanges()) {
      toast.info('No changes to update')
      setIsEditing(false)
      return
    }

    if (!form.item_name.trim()) {
      toast.error('Item name is required')
      return
    }

    if (item?.has_batch_no && !(form.shelf_life_in_days && form.shelf_life_in_days > 0)) {
      toast.error('Batch-tracked items need shelf life (days) for expiry tracking')
      return
    }

    const stockChanged = form.available_qty !== originalForm?.available_qty
    if (stockChanged && !form.correction_reason) {
      toast.error('Please select a reason for the stock correction')
      return
    }

    setIsSaving(true)
    if (stockChanged) setIsUpdatingStock(true)

    try {
      let resolvedWarehouse = (item?.warehouse || "").trim()
      if (stockChanged && !resolvedWarehouse) {
        try {
          const whRes = await fetch(
            "/api/method/klik_pos.api.item.get_pos_default_warehouse",
            await frappeJsonPostInit({})
          )
          const whData = await whRes.json()
          const wm = whData.message as Record<string, unknown> | undefined
          const w = typeof wm?.warehouse === "string" ? wm.warehouse.trim() : ""
          if (w) resolvedWarehouse = w
        } catch {
          console.error("Failed to resolve POS warehouse for stock update")
        }
      }
      if (stockChanged && !resolvedWarehouse) {
        toast.error(
          "No warehouse is available for stock reconciliation. Set a warehouse on the active POS Profile in ERPNext, then refresh this page."
        )
        return
      }

      const barcodeChanged = form.barcode !== originalForm?.barcode
      const sellingPriceChanged = form.standard_rate !== originalForm?.standard_rate
      const buyingPriceChanged = form.valuation_rate !== originalForm?.valuation_rate

      const payload: Record<string, unknown> = {
        item_code: itemCode,
        item_name: form.item_name,
        item_group: form.item_group,
        stock_uom: form.stock_uom,
        shelf_life_in_days: form.shelf_life_in_days || 0,
        has_expiry_date: item?.has_batch_no
          ? 1
          : form.shelf_life_in_days && form.shelf_life_in_days > 0
            ? 1
            : (item?.has_expiry_date || 0),
        barcode: form.barcode || "",
        barcode_changed: barcodeChanged ? 1 : 0,
        selling_price: form.standard_rate,
        buying_price: form.valuation_rate,
        selling_price_changed: sellingPriceChanged ? 1 : 0,
        buying_price_changed: buyingPriceChanged ? 1 : 0,
        image_data: newImage || "",
        image_changed: newImage ? 1 : 0,
        available_qty: form.available_qty,
        stock_changed: stockChanged ? 1 : 0,
        expected_qty: originalForm?.available_qty ?? 0,
        correction_reason: form.correction_reason,
        correction_note: form.correction_note,
        warehouse: stockChanged ? resolvedWarehouse : (item?.warehouse || "").trim(),
      }

      const response = await fetch(
        "/api/method/klik_pos.api.item.update_item_detail",
        await frappeJsonPostInit(payload)
      )

      const raw = (await response.json()) as Record<string, unknown>

      if (!response.ok) {
        const msg =
          parseFrappeClientError(raw) ||
          (typeof raw.message === "string" ? raw.message : null) ||
          `Request failed (${response.status})`
        throw new Error(msg)
      }

      if (raw.exc || raw.exception) {
        throw new Error(String(raw.exc || raw.exception || "Update failed"))
      }

      const msg = normalizeFrappeMethodMessage(raw.message)
      if (!msg || msg.status !== "success") {
        const detail =
          typeof msg?.message === "string"
            ? msg.message
            : "Update did not complete."
        throw new Error(detail)
      }

      // Price toasts
      const pricesUpdated = (msg.prices_updated as string[] | undefined) || []
      if (pricesUpdated.includes("selling") && pricesUpdated.includes("buying")) {
        toast.success("Selling and buying prices updated")
      } else if (pricesUpdated.includes("selling")) {
        toast.success("Selling price updated")
      } else if (pricesUpdated.includes("buying")) {
        toast.success("Buying price updated")
      }

      // Stock toast with SR reference
      if (msg.stock_updated) {
        const sd = msg.stock_detail as Record<string, unknown> | undefined
        const srName = sd?.reconciliation_name ?? ""
        const oldQ = sd?.old_qty ?? ""
        const newQ = sd?.new_qty ?? ""
        const whName = typeof sd?.warehouse === "string" ? sd.warehouse.trim() : ""
        const whPart = whName ? ` in ${whName}` : ""
        toast.success(
          `Stock corrected${whPart}: ${String(oldQ)} → ${String(newQ)}` +
            (srName ? ` · ${String(srName)}` : "")
        )
      }

      toast.success("Item updated successfully!")
      setIsEditing(false)
      setNewImage(null)
      await fetchItemDetails()
    } catch (err) {
      console.error("Error updating item:", err)
      const m = err instanceof Error ? err.message : "Failed to update item"
      toast.error(m)
    } finally {
      setIsSaving(false)
      setIsUpdatingStock(false)
    }
  }

  // Export item details to CSV
  const handleExportCSV = () => {
    if (!item) return
    
    // CSV headers
    const headers = [
      'Item Code',
      'Item Name',
      'Barcode',
      'Selling Price',
      'Buying Price',
      'Stock Qty',
      'UOM',
      'Shelf Life (Days)',
      'Item Group',
      'Batch Tracked',
      'Expiry Tracked'
    ]
    
    // CSV row data
    const rowData = [
      item.item_code,
      item.item_name,
      item.barcode || '',
      formatGroupedAmount(item.standard_rate),
      formatGroupedAmount(item.valuation_rate),
      item.available_qty.toString(),
      item.stock_uom,
      item.shelf_life_in_days?.toString() || '',
      item.item_group,
      item.has_batch_no ? 'Yes' : 'No',
      item.has_expiry_date ? 'Yes' : 'No'
    ]
    
    // Escape CSV values (handle commas, quotes, newlines)
    const escapeCSV = (value: string): string => {
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`
      }
      return value
    }
    
    // Build CSV content
    const csvContent = [
      headers.map(escapeCSV).join(','),
      rowData.map(escapeCSV).join(',')
    ].join('\n')
    
    // Create blob and download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    
    link.setAttribute('href', url)
    link.setAttribute('download', `${item.item_code}_details.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    
    toast.success('Item details exported to CSV')
  }

  // Make item inactive (Administrator only)
  const handleMakeInactive = async () => {
    if (!itemCode || !isAdministrator) return
    
    setIsTogglingDisabled(true)
    try {
      const response = await fetch(
        "/api/method/klik_pos.api.item.set_item_disabled",
        await frappeJsonPostInit({ item_code: itemCode, disabled: 1 })
      )
      const data = await response.json()
      
      if (data.message?.status === 'success' || data.message?.disabled === 1) {
        setItem(prev => prev ? { ...prev, disabled: 1 } : null)
        toast.success('Item has been made inactive. It will not appear in Purchase, Sales, or Item list.')
        setShowInactiveConfirm(false)
      } else {
        throw new Error(data.exc || data.message?.message || 'Failed to make item inactive')
      }
    } catch (err: any) {
      console.error('Error making item inactive:', err)
      toast.error(err.message || 'Failed to make item inactive')
    } finally {
      setIsTogglingDisabled(false)
    }
  }

  // Make item active again (Administrator only)
  const handleMakeActive = async () => {
    if (!itemCode || !isAdministrator) return
    
    setIsTogglingDisabled(true)
    try {
      const response = await fetch(
        "/api/method/klik_pos.api.item.set_item_disabled",
        await frappeJsonPostInit({ item_code: itemCode, disabled: 0 })
      )
      const data = await response.json()
      
      if (data.message?.status === 'success' || data.message?.disabled === 0) {
        setItem(prev => prev ? { ...prev, disabled: 0 } : null)
        toast.success('Item has been re-enabled. It will now appear in Purchase, Sales, and Item list.')
        setShowActiveConfirm(false)
      } else {
        throw new Error(data.exc || data.message?.message || 'Failed to re-enable item')
      }
    } catch (err: any) {
      console.error('Error re-enabling item:', err)
      toast.error(err.message || 'Failed to re-enable item')
    } finally {
      setIsTogglingDisabled(false)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-4 lg:pb-0 lg:ml-20 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-brand-600" />
      </div>
    )
  }

  if (!item) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-4 lg:pb-0 lg:ml-20">
        <div className="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 pl-14 pr-4 py-3 lg:px-4">
          <div className="flex items-center space-x-3">
            <button onClick={() => navigate('/items')} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
              <ArrowLeft size={20} />
            </button>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Item Not Found</h1>
          </div>
        </div>
        <div className="p-4 text-center text-gray-500 dark:text-gray-400 space-y-2">
          <p>The item could not be found.</p>
          {loadError ? (
            <p className="text-sm text-red-600 dark:text-red-400 max-w-lg mx-auto whitespace-pre-wrap break-words">
              {loadError}
            </p>
          ) : itemCode ? (
            <p className="text-xs text-gray-400 dark:text-gray-500 font-mono break-all">Code: {itemCode}</p>
          ) : null}
        </div>
        <div className="lg:hidden">
          <BottomNavigation />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-4 lg:pb-0 lg:ml-20">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 pl-14 pr-4 py-3 lg:px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <button 
              onClick={() => navigate('/items')} 
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
            >
              <ArrowLeft size={20} />
            </button>
            <div className="flex items-center space-x-2">
              <Package className="text-brand-600" size={24} />
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                {isEditing ? 'Edit Item' : 'Item Details'}
              </h1>
              {isItemDisabled && (
                <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200">
                  Inactive
                </span>
              )}
            </div>
          </div>
          
          {isEditing ? (
            <div className="flex items-center space-x-2">
              <button
                onClick={handleCancelEdit}
                className="flex items-center space-x-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <X size={18} />
                <span>Cancel</span>
              </button>
              <button
                onClick={handleUpdate}
                disabled={isSaving || isUpdatingStock}
                className="flex items-center space-x-1 px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors disabled:opacity-50"
              >
                {(isSaving || isUpdatingStock) ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                <span>{isUpdatingStock ? 'Updating Stock...' : 'Update'}</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center space-x-2">
              {/* Export CSV Button */}
              <button
                onClick={handleExportCSV}
                className="flex items-center space-x-1 px-3 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                title="Export to CSV"
              >
                <Download size={18} />
                <span className="hidden sm:inline">Export</span>
              </button>
              {/* Print Barcode Button - only show if item has barcode */}
              {item.barcode && (
                <button
                  onClick={() => setShowPrintDialog(true)}
                  className="flex items-center space-x-1 px-3 py-2 border border-brand-600 text-brand-600 rounded-lg hover:bg-brand-50 dark:hover:bg-brand-900/20 transition-colors"
                  title="Print Barcode Labels"
                >
                  <Printer size={18} />
                  <span className="hidden sm:inline">Print</span>
                </button>
              )}
              <button
                onClick={() => setIsEditing(true)}
                className="flex items-center space-x-1 px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors"
              >
                <Edit2 size={18} />
                <span>Edit</span>
              </button>
              
              {/* Make Inactive / Make Active Button - Administrator only */}
              {isAdministrator && (
                isItemDisabled ? (
                  <button
                    onClick={() => setShowActiveConfirm(true)}
                    disabled={isTogglingDisabled}
                    className="flex items-center space-x-1 px-3 py-2 border border-green-600 text-green-600 dark:text-green-400 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors disabled:opacity-50"
                    title="Make item active again"
                  >
                    {isTogglingDisabled ? (
                      <Loader2 size={18} className="animate-spin" />
                    ) : (
                      <CheckCircle size={18} />
                    )}
                    <span className="hidden sm:inline">Make Active</span>
                  </button>
                ) : (
                  <button
                    onClick={() => setShowInactiveConfirm(true)}
                    className="flex items-center space-x-1 px-3 py-2 border border-amber-500 text-amber-700 dark:text-amber-400 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
                    title="Make item inactive (hidden from Purchase, Sales, Item list)"
                  >
                    <Ban size={18} />
                    <span className="hidden sm:inline">Make Inactive</span>
                  </button>
                )
              )}
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Modal: Make Inactive */}
      {showInactiveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full mx-4 p-6 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center space-x-3 mb-4">
              <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-full">
                <Ban size={24} className="text-amber-600 dark:text-amber-400" />
              </div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Make item inactive?
              </h2>
            </div>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              This item will be hidden from <strong>Purchase</strong>, <strong>Sales</strong>, and <strong>Item list</strong> for everyone. 
              Only Administrators can see and re-enable it from the inactive items list.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowInactiveConfirm(false)}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={handleMakeInactive}
                disabled={isTogglingDisabled}
                className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 flex items-center space-x-2"
              >
                {isTogglingDisabled && <Loader2 size={16} className="animate-spin" />}
                <span>{isTogglingDisabled ? 'Processing...' : 'Make Inactive'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal: Make Active */}
      {showActiveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-modal="true">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full mx-4 p-6 border border-gray-200 dark:border-gray-700">
            <div className="flex items-center space-x-3 mb-4">
              <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-full">
                <CheckCircle size={24} className="text-green-600 dark:text-green-400" />
              </div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Re-enable this item?
              </h2>
            </div>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              This item will appear again in <strong>Purchase</strong>, <strong>Sales</strong>, and <strong>Item list</strong> for everyone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowActiveConfirm(false)}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={handleMakeActive}
                disabled={isTogglingDisabled}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center space-x-2"
              >
                {isTogglingDisabled && <Loader2 size={16} className="animate-spin" />}
                <span>{isTogglingDisabled ? 'Processing...' : 'Make Active'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Barcode Print Dialog */}
      {item.barcode && (
        <BarcodePrintDialog
          isOpen={showPrintDialog}
          onClose={() => setShowPrintDialog(false)}
          barcode={item.barcode}
          itemName={item.item_name}
          itemCode={item.item_code}
          sellingPrice={item.standard_rate}
        />
      )}

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Image Section */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">Item Image</h2>
          <div className="flex justify-center">
            {isEditing ? (
              <div className="relative">
                {newImage || item.image ? (
                  <div className="relative">
                    <img
                      src={newImage || item.image || ''}
                      alt={item.item_name}
                      className="w-32 h-32 object-cover rounded-lg border-2 border-gray-200 dark:border-gray-600"
                    />
                    {newImage && (
                      <button
                        type="button"
                        onClick={removeNewImage}
                        className="absolute -top-2 -right-2 p-1.5 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors shadow-lg"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                    <label className="absolute bottom-0 right-0 p-2 bg-brand-600 text-white rounded-full cursor-pointer hover:bg-brand-700 shadow-lg">
                      <ImagePlus size={16} />
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleImageUpload}
                        className="hidden"
                        disabled={isOptimizingImage}
                      />
                    </label>
                  </div>
                ) : (
                  <label className="w-32 h-32 flex flex-col items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer hover:border-brand-500 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    {isOptimizingImage ? (
                      <Loader2 size={24} className="animate-spin text-gray-400" />
                    ) : (
                      <>
                        <ImagePlus size={24} className="text-gray-400 mb-1" />
                        <span className="text-xs text-gray-500">Upload</span>
                      </>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      className="hidden"
                      disabled={isOptimizingImage}
                    />
                  </label>
                )}
              </div>
            ) : (
              item.image ? (
                <img
                  src={item.image}
                  alt={item.item_name}
                  className="w-32 h-32 object-cover rounded-lg border-2 border-gray-200 dark:border-gray-600"
                />
              ) : (
                <div className="w-32 h-32 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded-lg border-2 border-gray-200 dark:border-gray-600">
                  <Package size={32} className="text-gray-400" />
                </div>
              )
            )}
          </div>
        </div>

        {/* Basic Info */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">Basic Information</h2>
          <div className="space-y-4">
            {/* Item Code (Read-only) */}
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Item Code</label>
              <div className="px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg text-gray-900 dark:text-white font-mono text-sm">
                {item.item_code}
              </div>
            </div>

            {/* Item Name */}
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Item Name</label>
              {isEditing ? (
                <input
                  type="text"
                  value={form.item_name}
                  onChange={(e) => setForm(prev => ({ ...prev, item_name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              ) : (
                <div className="px-3 py-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-gray-900 dark:text-white">
                  {item.item_name}
                </div>
              )}
            </div>

            {/* Item Group */}
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Item Group</label>
              {isEditing ? (
                <select
                  value={form.item_group}
                  onChange={(e) => setForm(prev => ({ ...prev, item_group: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  {itemGroups.map(group => (
                    <option key={group} value={group}>{group}</option>
                  ))}
                </select>
              ) : (
                <div className="px-3 py-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-gray-900 dark:text-white">
                  {item.item_group}
                </div>
              )}
            </div>

            {/* UOM */}
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Stock UOM</label>
              {isEditing ? (
                <select
                  value={form.stock_uom}
                  onChange={(e) => setForm(prev => ({ ...prev, stock_uom: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  {commonUOMs.map(uom => (
                    <option key={uom} value={uom}>{uom}</option>
                  ))}
                </select>
              ) : (
                <div className="px-3 py-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-gray-900 dark:text-white">
                  {item.stock_uom}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Barcode */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center space-x-2 mb-3">
            <Barcode size={16} className="text-gray-500" />
            <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">Barcode</h2>
          </div>
          {isEditing ? (
            <input
              type="text"
              value={form.barcode}
              onChange={(e) => setForm(prev => ({ ...prev, barcode: e.target.value }))}
              placeholder="Enter barcode"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono"
            />
          ) : (
            <div className="px-3 py-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-gray-900 dark:text-white font-mono">
              {item.barcode || <span className="text-gray-400">No barcode</span>}
            </div>
          )}
        </div>

        {/* Stock & Pricing */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center space-x-2 mb-3">
            <DollarSign size={16} className="text-gray-500" />
            <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">Stock & Pricing</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Available Stock (Editable in edit mode) */}
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Available Stock</label>
              {isEditing ? (
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.available_qty}
                  onChange={(e) => setForm(prev => ({ ...prev, available_qty: parseFloat(e.target.value) || 0 }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder="0"
                />
              ) : (
                <div className="px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg text-gray-900 dark:text-white flex items-center">
                  <Box size={16} className="mr-2 text-gray-500" />
                  {item.available_qty} {item.stock_uom}
                </div>
              )}
            </div>

            {/* Selling Price */}
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Selling Price</label>
              {isEditing ? (
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.standard_rate}
                  onChange={(e) => setForm(prev => ({ ...prev, standard_rate: parseFloat(e.target.value) || 0 }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              ) : (
                <div className="px-3 py-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-gray-900 dark:text-white">
                  {formatGroupedAmount(item.standard_rate)}
                </div>
              )}
            </div>

            {/* Buying Price */}
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Buying Price</label>
              {isEditing ? (
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.valuation_rate}
                  onChange={(e) => setForm(prev => ({ ...prev, valuation_rate: parseFloat(e.target.value) || 0 }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              ) : (
                <div className="px-3 py-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-gray-900 dark:text-white">
                  {formatGroupedAmount(item.valuation_rate)}
                </div>
              )}
            </div>
          </div>

          {!isEditing && item.has_batch_no > 0 && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-gray-600 dark:text-gray-400">
                <span className="font-medium text-gray-800 dark:text-gray-200">
                  Sellable right now (POS / checkout):
                </span>{" "}
                {formatGroupedAmount(item.sellable_qty)} {item.stock_uom}
              </p>
              {item.batch_warehouse_mismatch && (
                <div
                  role="alert"
                  className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-950 dark:text-amber-100"
                >
                  <p className="font-medium">Stock data mismatch</p>
                  <p className="mt-1 leading-relaxed">
                    Warehouse balance is {formatGroupedAmount(item.warehouse_qty)} {item.stock_uom}; batch stock
                    (ERPNext batch view) sums to {formatGroupedAmount(item.batch_total_qty)} {item.stock_uom}. Do not
                    trust the higher figure for sales — checkout uses the lower amount ({formatGroupedAmount(item.sellable_qty)} {item.stock_uom}). Run{" "}
                    <strong>Stock Reconciliation</strong> in ERPNext for this item and warehouse so both match.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Stock correction reason — shown only when qty is changed */}
          {isEditing && form.available_qty !== originalForm?.available_qty && (
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-600 space-y-3">
              <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                Stock qty changed from {originalForm?.available_qty ?? 0} to {form.available_qty} — a Stock Reconciliation will be created.
              </p>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                  Reason for correction <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.correction_reason}
                  onChange={(e) => setForm(prev => ({ ...prev, correction_reason: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                >
                  <option value="">Select a reason...</option>
                  {STOCK_CORRECTION_REASONS.map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Note (optional)</label>
                <input
                  type="text"
                  value={form.correction_note}
                  onChange={(e) => setForm(prev => ({ ...prev, correction_note: e.target.value }))}
                  placeholder="Additional details..."
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                />
              </div>
            </div>
          )}
        </div>

        {/* Shelf Life */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center space-x-2 mb-3">
            <Calendar size={16} className="text-gray-500" />
            <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">Shelf Life</h2>
          </div>
          {isEditing ? (
            <div className="space-y-2">
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1.5 text-xs cursor-pointer text-gray-700 dark:text-gray-300">
                  <input
                    type="radio"
                    name="itemDetailShelfLifeUnit"
                    checked={shelfLifeUnit === "months"}
                    onChange={() => setShelfLifeUnit("months")}
                    className="text-brand-600"
                  />
                  Months
                </label>
                <label className="flex items-center gap-1.5 text-xs cursor-pointer text-gray-700 dark:text-gray-300">
                  <input
                    type="radio"
                    name="itemDetailShelfLifeUnit"
                    checked={shelfLifeUnit === "days"}
                    onChange={() => setShelfLifeUnit("days")}
                    className="text-brand-600"
                  />
                  Days
                </label>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  min="0"
                  step={shelfLifeUnit === "months" ? "0.1" : "1"}
                  value={
                    shelfLifeUnit === "months"
                      ? (form.shelf_life_in_days ? Number((form.shelf_life_in_days / 30).toFixed(1)) : "")
                      : (form.shelf_life_in_days ?? "")
                  }
                  onChange={(e) => {
                    const raw = e.target.value
                    if (!raw.trim()) {
                      setForm(prev => ({ ...prev, shelf_life_in_days: null }))
                      return
                    }
                    const n = parseFloat(raw)
                    if (!Number.isFinite(n) || n < 0) {
                      setForm(prev => ({ ...prev, shelf_life_in_days: null }))
                      return
                    }
                    const days = shelfLifeUnit === "months" ? Math.round(n * 30) : Math.round(n)
                    setForm(prev => ({ ...prev, shelf_life_in_days: days > 0 ? days : null }))
                  }}
                  placeholder={shelfLifeUnit === "months" ? "Enter months" : "Enter days"}
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
                <span className="text-gray-500 dark:text-gray-400 text-sm">
                  {shelfLifeUnit}
                </span>
              </div>
            </div>
          ) : (
            <div className="px-3 py-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-gray-900 dark:text-white">
              {item.shelf_life_in_days ? (
                <>
                  {item.shelf_life_in_days} days
                  {item.shelf_life_in_days >= 30 && (
                    <span className="text-gray-500 ml-2">
                      (~{Math.round(item.shelf_life_in_days / 30)} months)
                    </span>
                  )}
                </>
              ) : (
                <span className="text-gray-400">Not set</span>
              )}
            </div>
          )}
        </div>

        {/* Batch Info (Read-only) */}
        {(item.has_batch_no || item.has_expiry_date) && (
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
            <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">Tracking</h2>
            <div className="flex flex-wrap gap-2">
              {item.has_batch_no ? (
                <span className="px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm">
                  Batch Tracked
                </span>
              ) : null}
              {item.has_expiry_date ? (
                <span className="px-3 py-1 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 rounded-full text-sm">
                  Expiry Tracked
                </span>
              ) : null}
            </div>

            {item.has_batch_no ? (
              <div className="mt-4 border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => void openBatchModal()}
                  disabled={batchStockLoading}
                  className="w-full text-left px-3 py-3 flex items-start gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 dark:text-white">Active batches</span>
                      <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" aria-hidden />
                    </div>
                    {batchStockLoading ? (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 flex items-center gap-2">
                        <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                        Loading batch stock…
                      </p>
                    ) : batchStockError ? (
                      <p className="text-xs text-red-600 dark:text-red-400 mt-1">{batchStockError}</p>
                    ) : batchStock ? (
                      batchStock.summary.batch_count === 0 ? (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          No on-hand batch stock in {batchStock.warehouse || item.warehouse || "POS warehouse"}
                        </p>
                      ) : (
                        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                          <div>
                            <span className="text-gray-500 dark:text-gray-400 block">Total qty</span>
                            <span className="text-gray-900 dark:text-white font-medium">
                              {formatGroupedAmount(batchStock.summary.total_qty)}
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-500 dark:text-gray-400 block">Batches</span>
                            <span className="text-gray-900 dark:text-white font-medium">
                              {batchStock.summary.batch_count}
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-500 dark:text-gray-400 block">Avg days to expiry</span>
                            <span className="text-gray-900 dark:text-white font-medium">
                              {batchStock.summary.avg_days_to_expiry == null
                                ? "—"
                                : batchStock.summary.avg_days_to_expiry.toFixed(1)}
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-500 dark:text-gray-400 block">Avg buy rate</span>
                            <span className="text-gray-900 dark:text-white font-medium">
                              {batchStock.summary.avg_buying_rate == null
                                ? "—"
                                : formatCurrency(batchStock.summary.avg_buying_rate, batchStock.currency)}
                            </span>
                          </div>
                        </div>
                      )
                    ) : null}
                  </div>
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {batchModalOpen && item?.has_batch_no && itemCode ? (
        <div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="batch-drilldown-title"
          onClick={closeBatchModal}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-t-xl sm:rounded-xl border border-gray-200 dark:border-gray-700 shadow-xl w-full sm:max-w-5xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2 p-4 border-b border-gray-200 dark:border-gray-600 shrink-0">
              <div className="min-w-0">
                <h4 id="batch-drilldown-title" className="text-base font-semibold text-gray-900 dark:text-white">
                  On-hand batches
                </h4>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
                  {item.item_name} · {itemCode}
                  {batchStock?.warehouse ? ` · ${batchStock.warehouse}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={closeBatchModal}
                className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-auto flex-1 p-3 sm:p-4">
              {batchModalLoading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-gray-500 dark:text-gray-400">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Loading batches…
                </div>
              ) : batchModalError ? (
                <p className="text-sm text-red-600 dark:text-red-400 py-6 text-center">{batchModalError}</p>
              ) : !batchStock || batchStock.batches.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">
                  No on-hand batch stock in {batchStock?.warehouse || item.warehouse || "this warehouse"}.
                </p>
              ) : (
                <table className="min-w-full text-xs sm:text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-600">
                      <th className="pb-2 pr-2">Batch</th>
                      <th className="pb-2 pr-2 text-right">Qty</th>
                      <th className="pb-2 pr-2 hidden sm:table-cell">Expiry</th>
                      <th className="pb-2 pr-2">Source</th>
                      <th className="pb-2 pr-2 hidden md:table-cell">Supplier</th>
                      <th className="pb-2 pr-2 text-right">Buy rate</th>
                      <th className="pb-2 pr-2 hidden lg:table-cell whitespace-nowrap">PI date</th>
                      <th className="pb-2 pr-2 hidden lg:table-cell whitespace-nowrap">Last movement</th>
                    </tr>
                  </thead>
                  <tbody className="text-gray-900 dark:text-gray-100">
                    {batchStock.batches.map((row) => {
                      const buy =
                        row.pi_rate != null && row.pi_rate > 0
                          ? row.pi_rate
                          : row.sle_incoming_rate != null && row.sle_incoming_rate > 0
                            ? row.sle_incoming_rate
                            : null
                      const origin = typeof window !== "undefined" ? window.location.origin : ""
                      const piHref =
                        row.purchase_invoice && origin
                          ? `${origin}/app/purchase-invoice/${encodeURIComponent(row.purchase_invoice)}`
                          : null
                      const prDocHref =
                        row.purchase_receipt && origin
                          ? `${origin}/app/purchase-receipt/${encodeURIComponent(row.purchase_receipt)}`
                          : null
                      const receiptOrPiHref = piHref || prDocHref
                      const seHref =
                        row.sle_voucher_type === "Stock Entry" && row.sle_voucher_no && origin
                          ? `${origin}/app/stock-entry/${encodeURIComponent(row.sle_voucher_no)}`
                          : null
                      const piMovementHref =
                        row.sle_voucher_type === "Purchase Invoice" && row.sle_voucher_no && origin
                          ? `${origin}/app/purchase-invoice/${encodeURIComponent(row.sle_voucher_no)}`
                          : null
                      const prMovementHref =
                        row.sle_voucher_type === "Purchase Receipt" && row.sle_voucher_no && origin
                          ? `${origin}/app/purchase-receipt/${encodeURIComponent(row.sle_voucher_no)}`
                          : null
                      const siMovementHref =
                        row.sle_voucher_type === "Sales Invoice" && row.sle_voucher_no && origin
                          ? `${origin}/app/sales-invoice/${encodeURIComponent(row.sle_voucher_no)}`
                          : null
                      const lastMovementHref =
                        seHref || piMovementHref || prMovementHref || siMovementHref
                      const isEditingExpiry = editingBatchNo === row.batch_no
                      return (
                        <tr key={row.batch_no} className="border-b border-gray-100 dark:border-gray-700/80 align-top">
                          <td className="py-2 pr-2 font-mono text-[11px] sm:text-xs break-all">{row.batch_id}</td>
                          <td className="py-2 pr-2 text-right whitespace-nowrap">{formatGroupedAmount(row.qty)}</td>
                          <td className="py-2 pr-2 hidden sm:table-cell text-gray-600 dark:text-gray-400 whitespace-nowrap">
                            {isEditingExpiry ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="date"
                                  value={editingBatchExpiry}
                                  onChange={(e) => setEditingBatchExpiry(e.target.value)}
                                  className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-xs"
                                />
                                <button
                                  type="button"
                                  onClick={() => void saveBatchExpiry()}
                                  disabled={isSavingBatchExpiry}
                                  className="px-2 py-1 rounded bg-brand-600 text-white text-[11px] disabled:opacity-60"
                                >
                                  {isSavingBatchExpiry ? "..." : "Save"}
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelEditBatchExpiry}
                                  disabled={isSavingBatchExpiry}
                                  className="px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-[11px] text-gray-700 dark:text-gray-200 disabled:opacity-60"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <span>
                                  {row.expiry_date
                                    ? `${row.expiry_date}${row.days_to_expiry != null ? ` (${row.days_to_expiry}d)` : ""}`
                                    : "—"}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => startEditBatchExpiry(row)}
                                  className="inline-flex items-center gap-1 text-brand-600 hover:underline dark:text-brand-400"
                                >
                                  <Edit2 className="w-3 h-3" />
                                  <span className="text-[11px]">Edit</span>
                                </button>
                              </div>
                            )}
                          </td>
                          <td className="py-2 pr-2">{row.source_label}</td>
                          <td className="py-2 pr-2 hidden md:table-cell text-gray-600 dark:text-gray-400">
                            {row.supplier_name || "—"}
                          </td>
                          <td className="py-2 pr-2 text-right whitespace-nowrap">
                            {buy != null ? formatCurrency(buy, batchStock.currency) : "—"}
                          </td>
                          <td className="py-2 pr-2 hidden lg:table-cell whitespace-nowrap">
                            {row.pi_posting_date ? (
                              receiptOrPiHref ? (
                                <a
                                  href={receiptOrPiHref}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-brand-600 hover:underline dark:text-brand-400"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {row.pi_posting_date}
                                  <ExternalLink className="w-3 h-3 shrink-0 opacity-70" aria-hidden />
                                </a>
                              ) : (
                                row.pi_posting_date
                              )
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="py-2 pr-2 hidden lg:table-cell whitespace-nowrap text-gray-600 dark:text-gray-400">
                            {row.sle_posting_date ? (
                              lastMovementHref ? (
                                <a
                                  href={lastMovementHref}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-brand-600 hover:underline dark:text-brand-400"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {row.sle_posting_date}
                                  <ExternalLink className="w-3 h-3 shrink-0 opacity-70" aria-hidden />
                                </a>
                              ) : (
                                row.sle_posting_date
                              )
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Bottom Navigation - hide on desktop */}
      <div className="lg:hidden">
        <BottomNavigation />
      </div>
    </div>
  )
}
