"use client"

import type { MenuItem } from "../../types"

interface PurchaseProductCardProps {
  item: MenuItem & { buying_price?: number }
  onAddToCart: (item: MenuItem & { buying_price?: number }) => void
  isMobile?: boolean
}

/**
 * Product card for Purchase mode
 * - Shows purchase/buying price instead of selling price
 * - Shows 0 qty for out of stock items (no disabled state)
 * - Items are always clickable since we're adding stock
 */
export default function PurchaseProductCard({ 
  item, 
  onAddToCart, 
  isMobile = false 
}: PurchaseProductCardProps) {
  
  // Use buying_price if available, otherwise fallback to price
  const purchasePrice = item.buying_price || item.price || 0
  const formattedPrice = `${item.currency_symbol || '₨'}${purchasePrice.toFixed(2)}`
  
  // Current stock - 0 or actual value
  const currentStock = item.available || 0
  const isZeroStock = currentStock <= 0

  return (
    <div
      className={`bg-white dark:bg-gray-800 rounded-xl border border-amber-200 dark:border-amber-700/50 overflow-hidden transition-all duration-200 hover:shadow-lg hover:scale-105 cursor-pointer active:scale-95 ${
        isMobile ? "touch-manipulation" : ""
      }`}
      onClick={() => onAddToCart(item)}
    >
      {/* Image */}
      <div className="relative">
        {item.image ? (
          <img
            src={item.image}
            alt={item.name}
            className={`w-full object-cover ${isMobile ? "h-24" : "h-32"}`}
            crossOrigin="anonymous"
          />
        ) : (
          <div className={`w-full ${isMobile ? "h-24" : "h-32"} bg-gray-100 dark:bg-gray-700 flex items-center justify-center`}>
            <div className="text-gray-400 dark:text-gray-500 text-sm font-medium">
              No Image
            </div>
          </div>
        )}
        
        {/* Stock Badge - Always shown */}
        <div className={`absolute top-2 right-2 px-1.5 py-0.5 rounded-md text-xs font-medium ${
          isZeroStock 
            ? "bg-red-500 text-white" 
            : "bg-slate-600 text-white"
        }`}>
          {currentStock}
        </div>
        
        {/* Zero Stock Overlay - subtle, not blocking */}
        {isZeroStock && (
          <div className="absolute top-2 left-2 bg-amber-500 text-white px-1.5 py-0.5 rounded-md text-xs font-bold">
            New Stock
          </div>
        )}
        
        {/* Purchase Mode Indicator - subtle amber border glow */}
        <div className="absolute inset-0 ring-2 ring-inset ring-amber-400/20 pointer-events-none" />
      </div>
      
      <div className={`${isMobile ? "p-2 h-14" : "p-3 h-18"} flex flex-col justify-between`}>
        <div>
          <h3 className={`font-semibold text-gray-900 dark:text-white truncate ${isMobile ? "text-xs" : "text-sm"}`}>
            {item.name}
          </h3>
        </div>
        <div className="flex items-center justify-between">
          <p className={`text-gray-500 dark:text-gray-400 capitalize ${isMobile ? "text-xs" : "text-xs"}`}>
            {item.category}
          </p>
          <div className="flex flex-col items-end">
            {/* Purchase Price - Amber colored */}
            <span className={`font-bold text-amber-600 dark:text-amber-400 ${isMobile ? "text-xs" : "text-sm"}`}>
              {formattedPrice}
            </span>
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              Buy Price
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
