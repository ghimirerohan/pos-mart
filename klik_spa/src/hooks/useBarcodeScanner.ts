import { useState } from 'react'
import { useProducts } from './useProducts'
import type { MenuItem } from '../../types'

export type ScanResult = {
  success: boolean
  code: string
  message: string
  item?: MenuItem
  reason?: 'found' | 'not_found' | 'no_stock' | 'error'
}

interface UseBarcodeScannerReturn {
  scanBarcode: (barcode: string) => Promise<ScanResult>
  isScanning: boolean
  error: string | null
  clearError: () => void
}

export function useBarcodeScanner(onAddToCart: (item: MenuItem) => void): UseBarcodeScannerReturn {
  const [isScanning, setIsScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { products } = useProducts()

  const clearError = () => setError(null)

  const scanBarcode = async (barcode: string): Promise<ScanResult> => {
    if (!barcode.trim()) {
      setError('Please enter a valid barcode')
      return { 
        success: false, 
        code: barcode, 
        message: 'Please enter a valid barcode',
        reason: 'error'
      }
    }

    setIsScanning(true)
    setError(null)

    try {
      // First try to find by barcode in the products list
      const foundItem = products.find(item => {
        return item.id === barcode ||
               item.barcode === barcode ||
               item.name.toLowerCase().includes(barcode.toLowerCase())
      })

      if (foundItem) {
        // Check stock availability
        if (foundItem.available <= 0) {
          setError('Item out of stock')
          return {
            success: false,
            code: barcode,
            message: `"${foundItem.name}" is out of stock`,
            item: foundItem,
            reason: 'no_stock'
          }
        }
        
        onAddToCart(foundItem)
        return {
          success: true,
          code: barcode,
          message: `Added "${foundItem.name}" to cart`,
          item: foundItem,
          reason: 'found'
        }
      }

      // If not found in local products, try API call
      try {
        // First try combined identifier endpoint (barcode/batch/serial)
        const response = await fetch(`/api/method/klik_pos.api.item.get_item_by_identifier?code=${encodeURIComponent(barcode)}`)
        const data = await response.json()

        if (data.message && data.message.item_code) {
          // Convert API response to MenuItem format
          const item: MenuItem = {
            id: data.message.item_code,
            name: data.message.item_name || data.message.item_code,
            category: data.message.item_group || 'General',
            price: data.message.price || 0,
            available: data.message.available || 0,
            image: data.message.image,
            sold: 0
          }
          
          // Check stock availability
          if (item.available <= 0) {
            setError('Item out of stock')
            return {
              success: false,
              code: barcode,
              message: `"${item.name}" is out of stock`,
              item: item,
              reason: 'no_stock'
            }
          }
          
          onAddToCart(item)
          return {
            success: true,
            code: barcode,
            message: `Added "${item.name}" to cart`,
            item: item,
            reason: 'found'
          }
        } else {
          setError('Product not found')
          return {
            success: false,
            code: barcode,
            message: `No item found for barcode "${barcode}"`,
            reason: 'not_found'
          }
        }
      } catch (apiError) {
        console.error('API error:', apiError)
        setError('Product not found')
        return {
          success: false,
          code: barcode,
          message: `No item found for barcode "${barcode}"`,
          reason: 'not_found'
        }
      }
    } catch (err) {
      console.error('Barcode scanning error:', err)
      setError('Error processing barcode')
      return {
        success: false,
        code: barcode,
        message: 'Error processing barcode',
        reason: 'error'
      }
    } finally {
      setIsScanning(false)
    }
  }

  return {
    scanBarcode,
    isScanning,
    error,
    clearError
  }
}
