"use client"

import { useI18n } from "../hooks/useI18n"
import type { CartItem } from "../../types"

interface CartItemRowProps {
  item: CartItem
  onUpdateQty: (itemCode: string, newQty: number) => void
}

export default function CartItemRow({ item, onUpdateQty }: CartItemRowProps) {
  const { isRTL } = useI18n()
          //eslint-disable-next-line @typescript-eslint/no-explicit-any
  const qty = (item as any).qty ?? (item as any).quantity ?? 0
          //eslint-disable-next-line @typescript-eslint/no-explicit-any
  const imageSrc = (item as any).imageURL ?? (item as any).image
          //eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nameEn = (item as any).nameEn ?? (item as any).name
          //eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nameAr = (item as any).nameAr ?? (item as any).name

  return (
    <div className="flex items-center py-2 gap-3">
      {imageSrc && (
        <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-700 flex-shrink-0">
          <img src={imageSrc as string} alt={nameEn as string} className="w-12 h-12 rounded-lg object-cover" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm leading-snug line-clamp-2 text-gray-900 dark:text-white">
          {isRTL ? (nameAr as string) : (nameEn as string)}
        </div>
        <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
          {isRTL ? (nameEn as string) : (nameAr as string)}
        </div>
      </div>

      <div className="flex items-center space-x-1.5 flex-shrink-0">
        <button
                //eslint-disable-next-line @typescript-eslint/no-explicit-any
          onClick={() => onUpdateQty((item as any).item_code ?? item.id, qty - 1)}
          className="w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-600"
        >
          −
        </button>
        <span className="w-7 text-center font-semibold text-sm text-gray-900 dark:text-white">{qty}</span>
        <button
        //eslint-disable-next-line @typescript-eslint/no-explicit-any
          onClick={() => onUpdateQty((item as any).item_code ?? item.id, qty + 1)}
          className="w-6 h-6 rounded-full bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-400 flex items-center justify-center hover:bg-blue-100 dark:hover:bg-blue-900/30"
        >
          +
        </button>
      </div>

      <div className="text-gray-800 dark:text-gray-200 font-semibold text-sm whitespace-nowrap flex-shrink-0">
        ₨ {(item.price * qty).toFixed(2)}
      </div>
    </div>
  )
}
