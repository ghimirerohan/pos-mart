"use client"

import { useState, useEffect, useCallback } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { 
  Package, 
  Plus, 
  Search, 
  ArrowLeft,
  Barcode,
  Save,
  X,
  Camera,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  ImagePlus,
  Trash2,
  Loader2,
  Usb
} from "lucide-react"
import BottomNavigation from "../components/BottomNavigation"
import BarcodeScannerModal from "../components/BarcodeScanner"
import { useUSBBarcodeScanner } from "../hooks/useUSBBarcodeScanner"
import { toast } from "react-toastify"

interface UOMConversion {
  uom: string
  conversionFactor: number
}

interface NewItemForm {
  barcode: string
  itemName: string
  itemCode: string
  itemCodeAuto: boolean
  uom: string
  uomConversions: UOMConversion[]
  hasBatch: boolean
  batchNumber: string
  batchAuto: boolean
  expiryType: 'date' | 'months'
  bestBefore: string
  shelfLifeMonths: number
  openingStock: number
  buyingPrice: number
  sellingPrice: number
  itemGroup: string
}

const initialFormState: NewItemForm = {
  barcode: "",
  itemName: "",
  itemCode: "",
  itemCodeAuto: true,
  uom: "Nos",
  uomConversions: [],
  hasBatch: true,  // Enabled by default
  batchNumber: "",
  batchAuto: true,  // Auto generate by default
  expiryType: 'months',  // Default to months entry
  bestBefore: "",
  shelfLifeMonths: 0,
  openingStock: 0,
  buyingPrice: 0,
  sellingPrice: 0,
  itemGroup: "Products"
}

// Image optimization settings
const MAX_IMAGE_WIDTH = 800
const MAX_IMAGE_HEIGHT = 800
const IMAGE_QUALITY = 0.8

// Optimize and compress image
const optimizeImage = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        let { width, height } = img
        
        // Calculate new dimensions maintaining aspect ratio
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
        
        // Use white background for transparent images
        ctx.fillStyle = '#FFFFFF'
        ctx.fillRect(0, 0, width, height)
        ctx.drawImage(img, 0, 0, width, height)
        
        // Convert to JPEG for better compression
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

export default function ItemsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const prefilledBarcode = searchParams.get('barcode') || ''
  
  const [view, setView] = useState<'list' | 'add'>(prefilledBarcode ? 'add' : 'list')
  const [searchQuery, setSearchQuery] = useState("")
  const [showScanner, setShowScanner] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [barcodeError, setBarcodeError] = useState<string | null>(null)
  const [items, setItems] = useState<Array<{name: string, item_code: string, item_name: string, barcode?: string, image?: string}>>([])
  const [isLoading, setIsLoading] = useState(false)
  
  // Image upload state
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [isOptimizingImage, setIsOptimizingImage] = useState(false)
  
  const [form, setForm] = useState<NewItemForm>({
    ...initialFormState,
    barcode: prefilledBarcode
  })

  // USB Barcode Scanner support for item creation
  // When in 'add' view, USB scanner input will fill the barcode field
  const handleUSBBarcodeScanned = useCallback(async (barcode: string) => {
    if (view !== 'add') return // Only process when adding item
    
    console.log('USB Scanner detected barcode for item:', barcode)
    toast.info(`Scanned: ${barcode}`, { autoClose: 1500 })
    
    // Update form with scanned barcode
    setForm(prev => ({ ...prev, barcode }))
    setBarcodeError(null)
    
    // Check if barcode already exists
    try {
      const response = await fetch(`/api/method/klik_pos.api.item.check_barcode_exists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode: barcode }),
        credentials: 'include'
      })
      const data = await response.json()
      if (data.message?.exists) {
        setBarcodeError(`Barcode "${barcode}" is already assigned to another item`)
        toast.error(`Barcode "${barcode}" already exists!`)
      } else {
        toast.success(`Barcode "${barcode}" is available`)
      }
    } catch (err) {
      console.error('Error checking barcode:', err)
    }
  }, [view])

  useUSBBarcodeScanner({
    onBarcodeScanned: handleUSBBarcodeScanned,
    enabled: view === 'add', // Only enabled when adding item
    minLength: 4,
    maxTimeBetweenChars: 50,
  })

  // Fetch items list with barcodes
  const fetchItems = async () => {
    setIsLoading(true)
    try {
      // Try primary API that fetches items with barcodes from child table
      const response = await fetch('/api/method/klik_pos.api.item.get_items_with_balance_and_price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          limit: 200,
          offset: 0
        }),
        credentials: 'include'
      })
      const data = await response.json()
      
      if (data.message?.items && data.message.items.length > 0) {
        // Map the response to our expected format
        const mappedItems = data.message.items.map((item: { id: string; name: string; barcode?: string; image?: string }) => ({
          name: item.id,
          item_code: item.id,
          item_name: item.name,
          barcode: item.barcode || '',
          image: item.image || ''
        }))
        setItems(mappedItems)
        return
      }
      
      // If primary API returns empty, try fallback
      throw new Error('Primary API returned no items')
    } catch (err) {
      console.error('Primary fetch failed, trying fallback:', err)
      // Fallback to basic fetch - get ALL items (no stock filter)
      try {
        const response = await fetch('/api/method/frappe.client.get_list', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            doctype: 'Item',
            fields: ['name', 'item_code', 'item_name', 'image'],
            filters: { disabled: 0 },
            limit_page_length: 200,
            order_by: 'modified desc'
          }),
          credentials: 'include'
        })
        const data = await response.json()
        if (data.message && data.message.length > 0) {
          setItems(data.message)
        } else {
          console.log('No items found in fallback either')
          setItems([])
        }
      } catch (fallbackErr) {
        console.error('Fallback fetch also failed:', fallbackErr)
        toast.error('Failed to load items')
        setItems([])
      }
    } finally {
      setIsLoading(false)
    }
  }

  // Fetch items on mount and when switching to list view
  useEffect(() => {
    if (view === 'list') {
      fetchItems()
    }
  }, [view])

  // Also fetch on initial mount
  useEffect(() => {
    if (!prefilledBarcode) {
      fetchItems()
    }
  }, [])

  // Check if barcode already exists
  const checkBarcodeExists = async (barcode: string): Promise<boolean> => {
    if (!barcode.trim()) return false
    
    try {
      const response = await fetch(`/api/method/klik_pos.api.item.check_barcode_exists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcode: barcode }),
        credentials: 'include'
      })
      const data = await response.json()
      return data.message?.exists === true
    } catch (err) {
      console.error('Error checking barcode:', err)
      return false
    }
  }

  const handleBarcodeScanned = async (barcode: string) => {
    setShowScanner(false)
    setForm(prev => ({ ...prev, barcode }))
    setBarcodeError(null)
    
    // Check if barcode already exists
    const exists = await checkBarcodeExists(barcode)
    if (exists) {
      setBarcodeError(`Barcode "${barcode}" is already assigned to another item`)
      toast.error(`Barcode "${barcode}" already exists!`)
    } else {
      toast.success(`Barcode "${barcode}" scanned successfully`)
    }
  }

  const handleBarcodeChange = async (barcode: string) => {
    setForm(prev => ({ ...prev, barcode }))
    setBarcodeError(null)
    
    // Debounced check
    if (barcode.trim().length >= 8) {
      const exists = await checkBarcodeExists(barcode)
      if (exists) {
        setBarcodeError(`Barcode "${barcode}" is already assigned to another item`)
      }
    }
  }

  // Handle image upload
  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    
    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file')
      return
    }
    
    // Validate file size (max 10MB before optimization)
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Image is too large. Max 10MB allowed.')
      return
    }
    
    setIsOptimizingImage(true)
    
    try {
      const optimizedImage = await optimizeImage(file)
      setImagePreview(optimizedImage)
      toast.success('Image uploaded and optimized')
    } catch (err) {
      console.error('Image optimization error:', err)
      toast.error('Failed to process image')
    } finally {
      setIsOptimizingImage(false)
    }
  }

  const removeImage = () => {
    setImagePreview(null)
  }

  const addUOMConversion = () => {
    setForm(prev => ({
      ...prev,
      uomConversions: [...prev.uomConversions, { uom: '', conversionFactor: 1 }]
    }))
  }

  const removeUOMConversion = (index: number) => {
    setForm(prev => ({
      ...prev,
      uomConversions: prev.uomConversions.filter((_, i) => i !== index)
    }))
  }

  const updateUOMConversion = (index: number, field: keyof UOMConversion, value: string | number) => {
    setForm(prev => ({
      ...prev,
      uomConversions: prev.uomConversions.map((conv, i) => 
        i === index ? { ...conv, [field]: value } : conv
      )
    }))
  }

  const generateBatchNumber = () => {
    const timestamp = Date.now().toString(36).toUpperCase()
    const random = Math.random().toString(36).substring(2, 6).toUpperCase()
    return `BATCH-${timestamp}-${random}`
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Validation
    if (!form.itemName.trim()) {
      toast.error('Item name is required')
      return
    }
    
    if (barcodeError) {
      toast.error('Please fix the barcode error before saving')
      return
    }
    
    if (form.sellingPrice < form.buyingPrice) {
      toast.warning('Selling price is less than buying price')
    }

    setIsSubmitting(true)
    
    try {
      // Generate item code if auto
      let itemCode = form.itemCode
      if (form.itemCodeAuto || !itemCode.trim()) {
        itemCode = '' // Let the API auto-generate
      }

      // Generate batch number if auto and batch is enabled
      let batchNumber = form.batchNumber
      if (form.hasBatch && form.batchAuto) {
        batchNumber = '' // Let the API auto-generate
      }

      // Calculate shelf life in days and expiry date
      let shelfLifeDays = 0
      let expiryDate = form.bestBefore || undefined
      
      if (form.hasBatch) {
        if (form.expiryType === 'months' && form.shelfLifeMonths > 0) {
          // Calculate shelf life in days (30 days per month)
          shelfLifeDays = form.shelfLifeMonths * 30
          // Calculate expiry date from today
          const expiry = new Date()
          expiry.setDate(expiry.getDate() + shelfLifeDays)
          expiryDate = expiry.toISOString().split('T')[0]
        } else if (form.expiryType === 'date' && form.bestBefore) {
          // Calculate shelf life from the date
          const today = new Date()
          const expiry = new Date(form.bestBefore)
          shelfLifeDays = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
          if (shelfLifeDays < 0) shelfLifeDays = 0
          expiryDate = form.bestBefore
        }
      }

      // Use the new API that handles barcode in child table and opening stock
      const response = await fetch('/api/method/klik_pos.api.item.create_item_with_barcode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_name: form.itemName,
          item_code: itemCode || undefined,
          item_group: form.itemGroup,
          stock_uom: form.uom,
          barcode: form.barcode || undefined,
          has_batch_no: form.hasBatch ? 1 : 0,
          has_expiry_date: form.hasBatch && (form.shelfLifeMonths > 0 || form.bestBefore) ? 1 : 0,
          shelf_life_in_days: shelfLifeDays > 0 ? shelfLifeDays : undefined,
          selling_price: form.sellingPrice,
          buying_price: form.buyingPrice,
          opening_stock: form.openingStock,
          batch_no: form.hasBatch && !form.batchAuto ? batchNumber : undefined,
          expiry_date: expiryDate,
          image_data: imagePreview || undefined
        }),
        credentials: 'include'
      })
      
      const result = await response.json()
      
      if (result.exc || result.exception || result._server_messages) {
        // Parse server messages for user-friendly error
        let errorMsg = 'Failed to create item'
        if (result._server_messages) {
          try {
            const messages = JSON.parse(result._server_messages)
            if (messages.length > 0) {
              const msg = JSON.parse(messages[0])
              errorMsg = msg.message || errorMsg
            }
          } catch {
            errorMsg = result.exc || result.exception || errorMsg
          }
        } else {
          errorMsg = result.exc || result.exception || errorMsg
        }
        throw new Error(errorMsg)
      }

      if (!result.message?.success) {
        throw new Error(result.message?.message || 'Failed to create item')
      }

      toast.success(`Item "${form.itemName}" created successfully!`)
      
      // Reset form and go back to list
      setForm(initialFormState)
      setImagePreview(null)
      setView('list')
      
    } catch (err) {
      console.error('Error creating item:', err)
      const errorMessage = err instanceof Error ? err.message : 'Failed to create item'
      toast.error(errorMessage)
    } finally {
      setIsSubmitting(false)
    }
  }

  const filteredItems = items.filter(item => 
    item.item_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.item_code?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.barcode?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-20 lg:pb-0 lg:ml-20">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {view === 'add' && (
              <button
                onClick={() => {
                  setForm(initialFormState)
                  setBarcodeError(null)
                  setImagePreview(null)
                  setView('list')
                }}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                <ArrowLeft size={20} />
              </button>
            )}
            <div className="flex items-center space-x-2">
              <Package className="text-beveren-600" size={24} />
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                {view === 'list' ? 'Items' : 'Add New Item'}
              </h1>
            </div>
          </div>
          
          {view === 'list' && (
            <button
              onClick={() => setView('add')}
              className="flex items-center space-x-2 px-4 py-2 bg-beveren-600 text-white rounded-lg hover:bg-beveren-700 transition-colors"
            >
              <Plus size={18} />
              <span>Add Item</span>
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {view === 'list' ? (
          /* Items List View */
          <div className="space-y-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search items by name, code, or barcode..."
                className="w-full pl-10 pr-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>

            {/* Refresh Button */}
            <button
              onClick={fetchItems}
              disabled={isLoading}
              className="flex items-center space-x-2 text-beveren-600 hover:text-beveren-700"
            >
              <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
              <span>Refresh</span>
            </button>

            {/* Items List */}
            <div className="space-y-2">
              {isLoading ? (
                <div className="text-center py-8 text-gray-500">Loading items...</div>
              ) : filteredItems.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  {searchQuery ? 'No items found' : 'No items yet. Add your first item!'}
                </div>
              ) : (
                filteredItems.map((item) => (
                  <div
                    key={item.name}
                    className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-medium text-gray-900 dark:text-white">
                          {item.item_name}
                        </h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          Code: {item.item_code}
                        </p>
                        {item.barcode && (
                          <p className="text-xs text-gray-400 dark:text-gray-500 flex items-center mt-1">
                            <Barcode size={12} className="mr-1" />
                            {item.barcode}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          /* Add Item Form */
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Barcode Section */}
            <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <Barcode size={20} className="mr-2 text-beveren-600" />
                Barcode
              </h2>
              
              <div className="flex space-x-2">
                <div className="flex-1 relative">
                  <input
                    type="text"
                    value={form.barcode}
                    onChange={(e) => handleBarcodeChange(e.target.value)}
                    placeholder="Enter or scan barcode"
                    className={`w-full px-4 py-3 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white ${
                      barcodeError ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
                    }`}
                  />
                  {barcodeError && (
                    <div className="absolute -bottom-6 left-0 text-red-500 text-xs flex items-center">
                      <AlertCircle size={12} className="mr-1" />
                      {barcodeError}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setShowScanner(true)}
                  className="px-4 py-3 bg-beveren-600 text-white rounded-lg hover:bg-beveren-700 transition-colors"
                >
                  <Camera size={20} />
                </button>
              </div>
              {barcodeError && <div className="h-4" />}
              
              {/* USB Scanner indicator */}
              <div className="mt-3 flex items-center text-xs text-gray-500 dark:text-gray-400">
                <Usb size={14} className="mr-1.5 text-green-500" />
                <span>USB barcode scanner ready - just scan to auto-fill</span>
              </div>
            </div>

            {/* Item Image Section */}
            <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <ImagePlus size={20} className="mr-2 text-beveren-600" />
                Item Image (Optional)
              </h2>
              
              <div className="flex flex-col items-center">
                {imagePreview ? (
                  <div className="relative">
                    <img
                      src={imagePreview}
                      alt="Item preview"
                      className="w-40 h-40 object-cover rounded-lg border-2 border-gray-200 dark:border-gray-600"
                    />
                    <button
                      type="button"
                      onClick={removeImage}
                      className="absolute -top-2 -right-2 p-1.5 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors shadow-lg"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ) : (
                  <label className="w-40 h-40 flex flex-col items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer hover:border-beveren-500 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    {isOptimizingImage ? (
                      <div className="flex flex-col items-center text-gray-400">
                        <Loader2 size={32} className="animate-spin mb-2" />
                        <span className="text-xs">Optimizing...</span>
                      </div>
                    ) : (
                      <>
                        <ImagePlus size={32} className="text-gray-400 mb-2" />
                        <span className="text-xs text-gray-500 dark:text-gray-400 text-center px-2">
                          Click to upload
                        </span>
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
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  Image will be optimized to max 800x800px
                </p>
              </div>
            </div>

            {/* Basic Info */}
            <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Basic Information
              </h2>
              
              <div className="space-y-4">
                {/* Item Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Item Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.itemName}
                    onChange={(e) => setForm(prev => ({ ...prev, itemName: e.target.value }))}
                    placeholder="Enter item name"
                    required
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>

                {/* Item Code */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Item Code
                  </label>
                  <div className="flex items-center space-x-3">
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.itemCodeAuto}
                        onChange={(e) => setForm(prev => ({ ...prev, itemCodeAuto: e.target.checked }))}
                        className="w-4 h-4 text-beveren-600 rounded"
                      />
                      <span className="text-sm text-gray-600 dark:text-gray-400">Auto Generate</span>
                    </label>
                  </div>
                  {!form.itemCodeAuto && (
                    <input
                      type="text"
                      value={form.itemCode}
                      onChange={(e) => setForm(prev => ({ ...prev, itemCode: e.target.value }))}
                      placeholder="Enter item code"
                      className="w-full mt-2 px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  )}
                </div>

                {/* Item Group */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Item Group
                  </label>
                  <select
                    value={form.itemGroup}
                    onChange={(e) => setForm(prev => ({ ...prev, itemGroup: e.target.value }))}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    {itemGroups.map(group => (
                      <option key={group} value={group}>{group}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* UOM Section */}
            <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Unit of Measure
              </h2>
              
              <div className="space-y-4">
                {/* Default UOM */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Stock UOM
                  </label>
                  <select
                    value={form.uom}
                    onChange={(e) => setForm(prev => ({ ...prev, uom: e.target.value }))}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    {commonUOMs.map(uom => (
                      <option key={uom} value={uom}>{uom}</option>
                    ))}
                  </select>
                </div>

                {/* UOM Conversions */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      UOM Conversions (Optional)
                    </label>
                    <button
                      type="button"
                      onClick={addUOMConversion}
                      className="text-beveren-600 hover:text-beveren-700 text-sm flex items-center"
                    >
                      <Plus size={16} className="mr-1" />
                      Add
                    </button>
                  </div>
                  
                  {form.uomConversions.map((conv, index) => (
                    <div key={index} className="flex items-center space-x-2 mb-2">
                      <select
                        value={conv.uom}
                        onChange={(e) => updateUOMConversion(index, 'uom', e.target.value)}
                        className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                      >
                        <option value="">Select UOM</option>
                        {commonUOMs.filter(u => u !== form.uom).map(uom => (
                          <option key={uom} value={uom}>{uom}</option>
                        ))}
                      </select>
                      <span className="text-gray-500">=</span>
                      <input
                        type="number"
                        value={conv.conversionFactor}
                        onChange={(e) => updateUOMConversion(index, 'conversionFactor', parseFloat(e.target.value) || 1)}
                        className="w-20 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                        min="0.001"
                        step="0.001"
                      />
                      <span className="text-gray-500 text-sm">{form.uom}</span>
                      <button
                        type="button"
                        onClick={() => removeUOMConversion(index)}
                        className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Batch Section */}
            <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Batch & Expiry (Optional)
              </h2>
              
              <div className="space-y-4">
                {/* Has Batch */}
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.hasBatch}
                    onChange={(e) => setForm(prev => ({ ...prev, hasBatch: e.target.checked }))}
                    className="w-5 h-5 text-beveren-600 rounded"
                  />
                  <span className="text-gray-700 dark:text-gray-300">Enable Batch Tracking</span>
                </label>

                {form.hasBatch && (
                  <>
                    {/* Batch Auto/Manual */}
                    <div className="ml-8">
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.batchAuto}
                          onChange={(e) => setForm(prev => ({ ...prev, batchAuto: e.target.checked }))}
                          className="w-4 h-4 text-beveren-600 rounded"
                        />
                        <span className="text-sm text-gray-600 dark:text-gray-400">Auto Generate Batch Number</span>
                      </label>
                      
                      {!form.batchAuto && (
                        <input
                          type="text"
                          value={form.batchNumber}
                          onChange={(e) => setForm(prev => ({ ...prev, batchNumber: e.target.value }))}
                          placeholder="Enter batch number"
                          className="w-full mt-2 px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        />
                      )}
                    </div>

                    {/* Best Before / Expiry */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Shelf Life / Expiry
                      </label>
                      
                      {/* Expiry Type Toggle */}
                      <div className="flex space-x-4 mb-3">
                        <label className="flex items-center space-x-2 cursor-pointer">
                          <input
                            type="radio"
                            name="expiryType"
                            checked={form.expiryType === 'months'}
                            onChange={() => setForm(prev => ({ ...prev, expiryType: 'months', bestBefore: '' }))}
                            className="w-4 h-4 text-beveren-600"
                          />
                          <span className="text-sm text-gray-600 dark:text-gray-400">Shelf Life (Months)</span>
                        </label>
                        <label className="flex items-center space-x-2 cursor-pointer">
                          <input
                            type="radio"
                            name="expiryType"
                            checked={form.expiryType === 'date'}
                            onChange={() => setForm(prev => ({ ...prev, expiryType: 'date', shelfLifeMonths: 0 }))}
                            className="w-4 h-4 text-beveren-600"
                          />
                          <span className="text-sm text-gray-600 dark:text-gray-400">Expiry Date</span>
                        </label>
                      </div>
                      
                      {form.expiryType === 'months' ? (
                        <div>
                          <div className="flex items-center space-x-2">
                            <input
                              type="number"
                              min="0"
                              value={form.shelfLifeMonths || ''}
                              onChange={(e) => setForm(prev => ({ ...prev, shelfLifeMonths: parseInt(e.target.value) || 0 }))}
                              placeholder="Enter months"
                              className="flex-1 px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                            />
                            <span className="text-gray-500 dark:text-gray-400">months</span>
                          </div>
                          {form.shelfLifeMonths > 0 && (
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                              = {form.shelfLifeMonths * 30} days shelf life
                            </p>
                          )}
                        </div>
                      ) : (
                        <input
                          type="date"
                          value={form.bestBefore}
                          onChange={(e) => setForm(prev => ({ ...prev, bestBefore: e.target.value }))}
                          className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        />
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Stock & Pricing */}
            <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Stock & Pricing
              </h2>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Opening Stock */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Opening Stock Qty
                  </label>
                  <input
                    type="number"
                    value={form.openingStock}
                    onChange={(e) => setForm(prev => ({ ...prev, openingStock: parseFloat(e.target.value) || 0 }))}
                    placeholder="0"
                    min="0"
                    step="0.01"
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>

                {/* Buying Price */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Buying Price
                  </label>
                  <input
                    type="number"
                    value={form.buyingPrice}
                    onChange={(e) => setForm(prev => ({ ...prev, buyingPrice: parseFloat(e.target.value) || 0 }))}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>

                {/* Selling Price */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Selling Price
                  </label>
                  <input
                    type="number"
                    value={form.sellingPrice}
                    onChange={(e) => setForm(prev => ({ ...prev, sellingPrice: parseFloat(e.target.value) || 0 }))}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
              </div>
              
              {form.sellingPrice > 0 && form.buyingPrice > 0 && (
                <div className="mt-3 text-sm">
                  <span className={`${form.sellingPrice >= form.buyingPrice ? 'text-green-600' : 'text-red-600'}`}>
                    Margin: {((form.sellingPrice - form.buyingPrice) / form.buyingPrice * 100).toFixed(1)}%
                  </span>
                </div>
              )}
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting || !!barcodeError}
              className={`w-full py-4 rounded-lg font-semibold text-white flex items-center justify-center space-x-2 transition-colors ${
                isSubmitting || barcodeError
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-beveren-600 hover:bg-beveren-700'
              }`}
            >
              {isSubmitting ? (
                <>
                  <RefreshCw size={20} className="animate-spin" />
                  <span>Creating Item...</span>
                </>
              ) : (
                <>
                  <Save size={20} />
                  <span>Save Item</span>
                </>
              )}
            </button>
          </form>
        )}
      </div>

      {/* Barcode Scanner Modal */}
      <BarcodeScannerModal
        isOpen={showScanner}
        onClose={() => setShowScanner(false)}
        onBarcodeDetected={handleBarcodeScanned}
      />

      {/* Bottom Navigation - hide on desktop where sidebar is shown */}
      <div className="lg:hidden">
        <BottomNavigation />
      </div>
    </div>
  )
}
