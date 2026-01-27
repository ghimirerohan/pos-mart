"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useProducts } from "../hooks/useProducts"
import { usePOSDetails } from "../hooks/usePOSProfile"
import { usePurchaseCartStore } from "../stores/purchaseCartStore"
import PurchaseOrderSummary from "./PurchaseOrderSummary"
import PurchaseProductCard from "./PurchaseProductCard"
import LoadingSpinner from "./LoadingSpinner"
import BarcodeScannerModal from "./BarcodeScanner"
import { useBarcodeScanner } from "../hooks/useBarcodeScanner"
import { useUSBBarcodeScanner } from "../hooks/useUSBBarcodeScanner"
import type { MenuItem } from "../../types"
import type { PurchaseCartItem } from "../types/supplier"
import { useMediaQuery } from "../hooks/useMediaQuery"
import { toast } from "react-toastify"
import { 
  Search, 
  ScanLine, 
  Grid3X3, 
  List, 
  Truck,
  PackagePlus,
  ChevronDown,
} from "lucide-react"

export default function PurchasePOSLayout() {
  const [selectedCategory, setSelectedCategory] = useState("all")
  const [localSearchQuery, setLocalSearchQuery] = useState("")
  const [showScanner, setShowScanner] = useState(false)
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")

  // Debounce timer ref for search
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null)

  // Use purchase cart store
  const { 
    cartItems, 
    addToCart, 
    updateQuantity, 
    removeItem, 
    clearCart,
  } = usePurchaseCartStore()

  // Use product data with pagination
  const {
    products: menuItems,
    isLoading: loading,
    isLoadingMore,
    isSearching,
    error,
    refetch,
    loadMoreProducts,
    searchProducts,
    hasMore,
    totalCount,
  } = useProducts()

  // Get POS details
  const { posDetails } = usePOSDetails()
  const currency_symbol = posDetails?.currency_symbol || "₨"

  // Use media query to detect mobile screens
  const isMobile = useMediaQuery("(max-width: 1024px)")

  // Get categories from menu items
  const categories = ["all", ...new Set(menuItems.map(item => item.category).filter(Boolean))]

  // Convert MenuItem to PurchaseCartItem
  const convertToPurchaseCartItem = (item: MenuItem & { buying_price?: number }): Omit<PurchaseCartItem, 'quantity'> => {
    const purchasePrice = item.buying_price || item.price || 0
    const sellingPrice = item.price || 0
    
    return {
      id: item.id,
      item_code: item.id,
      name: item.name,
      category: item.category,
      image: item.image,
      uom: item.uom || "Nos",
      purchase_price: purchasePrice,
      selling_price: sellingPrice,
      original_purchase_price: purchasePrice,
      original_selling_price: sellingPrice,
      currency_symbol: item.currency_symbol,
    }
  }

  // Handle adding item to cart
  const handleAddToCart = (item: MenuItem & { buying_price?: number }) => {
    const purchaseItem = convertToPurchaseCartItem(item)
    addToCart(purchaseItem)
    toast.success(`Added ${item.name} to purchase cart`, { autoClose: 1000 })
  }

  // Handle quantity update
  const handleUpdateQuantity = (id: string, quantity: number) => {
    if (quantity <= 0) {
      removeItem(id)
    } else {
      updateQuantity(id, quantity)
    }
  }

  // Handle remove item
  const handleRemoveItem = (id: string) => {
    removeItem(id)
  }

  // Handle clear cart
  const handleClearCart = () => {
    clearCart()
  }

  // Barcode scanning functionality
  const handleBarcodeAdd = useCallback((item: MenuItem) => {
    handleAddToCart(item as MenuItem & { buying_price?: number })
  }, [])

  const { scanBarcode } = useBarcodeScanner(handleBarcodeAdd)

  const handleBarcodeDetected = useCallback(async (barcode: string) => {
    toast.info(`Scanned: ${barcode}`, { autoClose: 1500, toastId: 'scan-info' })
    
    try {
      const response = await fetch(
        `/api/method/klik_pos.api.item.get_item_by_identifier?identifier=${encodeURIComponent(barcode)}`,
        {
          method: 'GET',
          credentials: 'include',
        }
      )
      const data = await response.json()
      
      if (data.message?.success && data.message?.data) {
        const itemData = data.message.data
        const item: MenuItem & { buying_price?: number } = {
          id: itemData.item_code,
          name: itemData.item_name,
          category: itemData.item_group || 'Products',
          price: itemData.price || 0,
          buying_price: itemData.buying_price || itemData.valuation_rate || 0,
          image: itemData.image || '',
          available: itemData.available || 0,
          sold: 0,
          uom: itemData.uom || 'Nos',
          currency_symbol: itemData.currency_symbol || currency_symbol,
        }
        handleAddToCart(item)
      } else {
        toast.error(`Item not found: ${barcode}`)
      }
    } catch (error) {
      console.error('Error scanning barcode:', error)
      toast.error('Failed to scan barcode')
    }
  }, [currency_symbol])

  // USB Barcode scanner hook
  useUSBBarcodeScanner(handleBarcodeDetected)

  // Handle search with debounce
  const handleSearch = (query: string) => {
    setLocalSearchQuery(query)
    
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current)
    }
    
    searchDebounceRef.current = setTimeout(() => {
      searchProducts(query)
    }, 300)
  }

  // Handle category change
  const handleCategoryChange = (category: string) => {
    setSelectedCategory(category)
    // TODO: Implement category filtering via API
  }

  // Handle scroll for infinite loading
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget
    if (scrollHeight - scrollTop - clientHeight < 200 && hasMore && !isLoadingMore) {
      loadMoreProducts()
    }
  }

  // Filter items by category (client-side)
  const filteredItems = selectedCategory === "all" 
    ? menuItems 
    : menuItems.filter(item => item.category === selectedCategory)

  if (loading && menuItems.length === 0) {
    return (
      <div className="flex h-screen bg-amber-50 dark:bg-gray-900 pb-8">
        <LoadingSpinner />
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900 pb-8">
      {/* Left Panel - Products */}
      <div className="flex-1 overflow-hidden ml-20">
        <div className="flex flex-col h-full">
          {/* Purchase Mode Banner */}
          <div className="bg-gradient-to-r from-amber-500 to-orange-500 text-white px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <PackagePlus size={24} />
              <div>
                <h1 className="text-lg font-bold">PURCHASE MODE</h1>
                <p className="text-xs opacity-90">Add stock by purchasing from suppliers</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Truck size={18} />
              <span>{cartItems.length} items in cart</span>
            </div>
          </div>

          {/* Search and Filters Bar */}
          <div className="px-6 py-4 bg-white dark:bg-gray-800 border-b border-amber-200 dark:border-amber-800/30">
            <div className="flex items-center gap-4">
              {/* Search Input */}
              <div className="relative flex-1">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by product, category, item code..."
                  value={localSearchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-amber-300 dark:border-amber-700 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
                {isSearching && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <div className="animate-spin w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full" />
                  </div>
                )}
              </div>

              {/* Barcode Scanner Button */}
              <button
                onClick={() => setShowScanner(true)}
                className="p-2 border border-amber-300 dark:border-amber-700 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
                title="Scan Barcode"
              >
                <ScanLine size={20} className="text-amber-600 dark:text-amber-400" />
              </button>

              {/* View Mode Toggle */}
              <div className="flex border border-amber-300 dark:border-amber-700 rounded-lg overflow-hidden">
                <button
                  onClick={() => setViewMode("grid")}
                  className={`p-2 ${viewMode === "grid" ? "bg-amber-500 text-white" : "bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300"}`}
                >
                  <Grid3X3 size={18} />
                </button>
                <button
                  onClick={() => setViewMode("list")}
                  className={`p-2 ${viewMode === "list" ? "bg-amber-500 text-white" : "bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300"}`}
                >
                  <List size={18} />
                </button>
              </div>
            </div>

            {/* Category Tabs */}
            <div className="flex items-center gap-2 mt-3 overflow-x-auto pb-2">
              {categories.slice(0, 8).map((category) => (
                <button
                  key={category}
                  onClick={() => handleCategoryChange(category)}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                    selectedCategory === category
                      ? "bg-amber-500 text-white"
                      : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-amber-100 dark:hover:bg-amber-900/20"
                  }`}
                >
                  {category === "all" ? "All Items" : category}
                </button>
              ))}
              {categories.length > 8 && (
                <button className="px-3 py-1.5 rounded-full text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 flex items-center gap-1">
                  More <ChevronDown size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Products Grid */}
          <div 
            className="flex-1 overflow-y-auto p-6 bg-gray-50 dark:bg-gray-900"
            onScroll={handleScroll}
          >
            {error ? (
              <div className="text-center py-8">
                <p className="text-red-500 mb-4">Error loading products</p>
                <button
                  onClick={() => refetch()}
                  className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600"
                >
                  Retry
                </button>
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="text-center py-8">
                <div className="text-6xl mb-4">📦</div>
                <p className="text-gray-500 dark:text-gray-400">No products found</p>
              </div>
            ) : (
              <>
                <div className={`grid gap-4 ${
                  viewMode === "grid" 
                    ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
                    : "grid-cols-1"
                }`}>
                  {filteredItems.map((item) => (
                    <PurchaseProductCard
                      key={item.id}
                      item={item as MenuItem & { buying_price?: number }}
                      onAddToCart={handleAddToCart}
                      isMobile={isMobile}
                    />
                  ))}
                </div>

                {/* Loading More Indicator */}
                {isLoadingMore && (
                  <div className="flex justify-center py-4">
                    <div className="animate-spin w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full" />
                  </div>
                )}

                {/* Total Count */}
                <div className="text-center text-sm text-gray-500 dark:text-gray-400 mt-4">
                  Showing {filteredItems.length} of {totalCount} items
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Right Panel - Order Summary */}
      <div className="w-[35%] min-w-[420px] max-w-[600px] bg-white shadow-lg overflow-y-auto">
        <PurchaseOrderSummary
          cartItems={cartItems}
          onUpdateQuantity={handleUpdateQuantity}
          onRemoveItem={handleRemoveItem}
          onClearCart={handleClearCart}
          isMobile={isMobile}
        />
      </div>

      {/* Barcode Scanner Modal */}
      {showScanner && (
        <BarcodeScannerModal
          onClose={() => setShowScanner(false)}
          onBarcodeDetected={(barcode) => {
            handleBarcodeDetected(barcode)
            setShowScanner(false)
          }}
        />
      )}
    </div>
  )
}
