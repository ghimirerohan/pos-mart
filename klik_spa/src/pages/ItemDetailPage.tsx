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
  Printer
} from "lucide-react"
import BottomNavigation from "../components/BottomNavigation"
import BarcodePrintDialog from "../components/BarcodePrintDialog"
import { toast } from "react-toastify"

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
}

interface EditForm {
  item_name: string
  item_group: string
  stock_uom: string
  standard_rate: number
  valuation_rate: number
  shelf_life_in_days: number | null
  barcode: string
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

export default function ItemDetailPage() {
  const navigate = useNavigate()
  const { itemCode } = useParams<{ itemCode: string }>()
  
  const [item, setItem] = useState<ItemDetails | null>(null)
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
    barcode: ''
  })
  const [newImage, setNewImage] = useState<string | null>(null)
  const [isOptimizingImage, setIsOptimizingImage] = useState(false)
  const [showPrintDialog, setShowPrintDialog] = useState(false)

  // Fetch item details
  const fetchItemDetails = useCallback(async () => {
    if (!itemCode) return
    
    setIsLoading(true)
    try {
      // Fetch item document
      const response = await fetch('/api/method/frappe.client.get', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doctype: 'Item',
          name: itemCode
        }),
        credentials: 'include'
      })
      const data = await response.json()
      
      if (data.message) {
        const itemDoc = data.message
        
        // Fetch barcode from child table
        let barcode = ''
        if (itemDoc.barcodes && itemDoc.barcodes.length > 0) {
          barcode = itemDoc.barcodes[0].barcode || ''
        }
        
        // Fetch stock qty
        let availableQty = 0
        try {
          const stockResponse = await fetch('/api/method/klik_pos.api.item.get_item_stock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item_code: itemCode }),
            credentials: 'include'
          })
          const stockData = await stockResponse.json()
          availableQty = stockData.message?.available || 0
        } catch {
          console.error('Failed to fetch stock')
        }
        
        const itemDetails: ItemDetails = {
          item_code: itemDoc.item_code,
          item_name: itemDoc.item_name,
          item_group: itemDoc.item_group,
          stock_uom: itemDoc.stock_uom,
          image: itemDoc.image,
          barcode: barcode,
          standard_rate: itemDoc.standard_rate || 0,
          valuation_rate: itemDoc.valuation_rate || 0,
          has_batch_no: itemDoc.has_batch_no || 0,
          has_expiry_date: itemDoc.has_expiry_date || 0,
          shelf_life_in_days: itemDoc.shelf_life_in_days || null,
          available_qty: availableQty
        }
        
        setItem(itemDetails)
        
        const formData: EditForm = {
          item_name: itemDetails.item_name,
          item_group: itemDetails.item_group,
          stock_uom: itemDetails.stock_uom,
          standard_rate: itemDetails.standard_rate,
          valuation_rate: itemDetails.valuation_rate,
          shelf_life_in_days: itemDetails.shelf_life_in_days,
          barcode: itemDetails.barcode || ''
        }
        setForm(formData)
        setOriginalForm(formData)
      }
    } catch (err) {
      console.error('Error fetching item:', err)
      toast.error('Failed to load item details')
    } finally {
      setIsLoading(false)
    }
  }, [itemCode])

  useEffect(() => {
    fetchItemDetails()
  }, [fetchItemDetails])

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
      form.barcode !== originalForm.barcode
    )
  }

  const handleCancelEdit = () => {
    if (originalForm) {
      setForm(originalForm)
    }
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
    
    setIsSaving(true)
    
    try {
      // Update item document
      const updateData: Record<string, unknown> = {
        item_name: form.item_name,
        item_group: form.item_group,
        stock_uom: form.stock_uom,
        standard_rate: form.standard_rate,
        valuation_rate: form.valuation_rate,
        shelf_life_in_days: form.shelf_life_in_days || 0,
        has_expiry_date: form.shelf_life_in_days && form.shelf_life_in_days > 0 ? 1 : (item?.has_expiry_date || 0)
      }
      
      // Handle barcode change
      const barcodeChanged = form.barcode !== originalForm?.barcode
      
      const response = await fetch('/api/method/frappe.client.set_value', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doctype: 'Item',
          name: itemCode,
          fieldname: updateData
        }),
        credentials: 'include'
      })
      
      const result = await response.json()
      
      if (result.exc || result.exception) {
        throw new Error(result.exc || result.exception)
      }
      
      // Handle barcode update separately (child table)
      if (barcodeChanged && itemCode) {
        try {
          await fetch('/api/method/klik_pos.api.item.update_item_barcode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              item_code: itemCode,
              barcode: form.barcode || ''
            }),
            credentials: 'include'
          })
        } catch (barcodeErr) {
          console.error('Barcode update failed:', barcodeErr)
        }
      }
      
      // Handle image upload
      if (newImage && itemCode) {
        try {
          await fetch('/api/method/klik_pos.api.item.update_item_image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              item_code: itemCode,
              image_data: newImage
            }),
            credentials: 'include'
          })
        } catch (imgErr) {
          console.error('Image update failed:', imgErr)
        }
      }
      
      toast.success('Item updated successfully!')
      setIsEditing(false)
      setNewImage(null)
      
      // Refresh item details
      await fetchItemDetails()
      
    } catch (err) {
      console.error('Error updating item:', err)
      toast.error('Failed to update item')
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-20 lg:pb-0 lg:ml-20 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-beveren-600" />
      </div>
    )
  }

  if (!item) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-20 lg:pb-0 lg:ml-20">
        <div className="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
          <div className="flex items-center space-x-3">
            <button onClick={() => navigate('/items')} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
              <ArrowLeft size={20} />
            </button>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Item Not Found</h1>
          </div>
        </div>
        <div className="p-4 text-center text-gray-500">
          The item could not be found.
        </div>
        <div className="lg:hidden">
          <BottomNavigation />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-20 lg:pb-0 lg:ml-20">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <button 
              onClick={() => navigate('/items')} 
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
            >
              <ArrowLeft size={20} />
            </button>
            <div className="flex items-center space-x-2">
              <Package className="text-beveren-600" size={24} />
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                {isEditing ? 'Edit Item' : 'Item Details'}
              </h1>
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
                disabled={isSaving}
                className="flex items-center space-x-1 px-4 py-2 bg-beveren-600 text-white rounded-lg hover:bg-beveren-700 transition-colors disabled:opacity-50"
              >
                {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                <span>Update</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center space-x-2">
              {/* Print Barcode Button - only show if item has barcode */}
              {item.barcode && (
                <button
                  onClick={() => setShowPrintDialog(true)}
                  className="flex items-center space-x-1 px-3 py-2 border border-beveren-600 text-beveren-600 rounded-lg hover:bg-beveren-50 dark:hover:bg-beveren-900/20 transition-colors"
                  title="Print Barcode Labels"
                >
                  <Printer size={18} />
                  <span className="hidden sm:inline">Print</span>
                </button>
              )}
              <button
                onClick={() => setIsEditing(true)}
                className="flex items-center space-x-1 px-4 py-2 bg-beveren-600 text-white rounded-lg hover:bg-beveren-700 transition-colors"
              >
                <Edit2 size={18} />
                <span>Edit</span>
              </button>
            </div>
          )}
        </div>
      </div>

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
                    <label className="absolute bottom-0 right-0 p-2 bg-beveren-600 text-white rounded-full cursor-pointer hover:bg-beveren-700 shadow-lg">
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
                  <label className="w-32 h-32 flex flex-col items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer hover:border-beveren-500 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
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
            {/* Available Stock (Read-only) */}
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Available Stock</label>
              <div className="px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg text-gray-900 dark:text-white flex items-center">
                <Box size={16} className="mr-2 text-gray-500" />
                {item.available_qty} {item.stock_uom}
              </div>
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
                  {item.standard_rate.toFixed(2)}
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
                  {item.valuation_rate.toFixed(2)}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Shelf Life */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center space-x-2 mb-3">
            <Calendar size={16} className="text-gray-500" />
            <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400">Shelf Life</h2>
          </div>
          {isEditing ? (
            <div className="flex items-center space-x-2">
              <input
                type="number"
                min="0"
                value={form.shelf_life_in_days || ''}
                onChange={(e) => setForm(prev => ({ ...prev, shelf_life_in_days: parseInt(e.target.value) || null }))}
                placeholder="Enter days"
                className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
              <span className="text-gray-500 dark:text-gray-400">days</span>
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
          </div>
        )}
      </div>

      {/* Bottom Navigation - hide on desktop */}
      <div className="lg:hidden">
        <BottomNavigation />
      </div>
    </div>
  )
}
