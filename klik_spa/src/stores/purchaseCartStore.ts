import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PurchaseCartItem, Supplier } from '../types/supplier'
import { toast } from 'react-toastify'

interface PurchaseCartState {
  cartItems: PurchaseCartItem[]
  selectedSupplier: Supplier | null

  // Actions
  addToCart: (item: Omit<PurchaseCartItem, 'quantity'>) => void
  addToCartWithQuantity: (item: Omit<PurchaseCartItem, 'quantity'>, quantity: number) => void
  updateQuantity: (id: string, quantity: number) => void
  updateUOM: (id: string, uom: string, purchasePrice: number, sellingPrice: number) => void
  updatePurchasePrice: (id: string, price: number) => void
  updateSellingPrice: (id: string, price: number) => void
  updateBatch: (id: string, batch: string) => void
  updateSerial: (id: string, serial: string) => void
  removeItem: (id: string) => void
  clearCart: () => void
  setSelectedSupplier: (supplier: Supplier | null) => void
  
  // Computed values
  getSubtotal: () => number
  getItemCount: () => number
  hasChangedPrices: () => boolean
  getChangedPriceItems: () => PurchaseCartItem[]
}

export const usePurchaseCartStore = create<PurchaseCartState>()(
  persist(
    (set, get) => ({
      cartItems: [],
      selectedSupplier: null,

      addToCart: (item) => {
        const state = get();
        const existingItem = state.cartItems.find((cartItem) => cartItem.id === item.id);

        if (existingItem) {
          // Increment quantity for existing item
          set((state) => ({
            cartItems: state.cartItems.map((cartItem) =>
              cartItem.id === item.id
                ? { ...cartItem, quantity: cartItem.quantity + 1 }
                : cartItem
            )
          }));
        } else {
          // Add new item with quantity 1
          const newItem: PurchaseCartItem = {
            ...item,
            quantity: 1,
          };
          set((state) => ({
            cartItems: [...state.cartItems, newItem]
          }));
        }
      },

      addToCartWithQuantity: (item, quantity) => {
        const state = get();
        const existingItem = state.cartItems.find((cartItem) => cartItem.id === item.id);

        if (existingItem) {
          // Add quantity to existing item
          set((state) => ({
            cartItems: state.cartItems.map((cartItem) =>
              cartItem.id === item.id
                ? { ...cartItem, quantity: cartItem.quantity + quantity }
                : cartItem
            )
          }));
        } else {
          // Add new item with specified quantity
          const newItem: PurchaseCartItem = {
            ...item,
            quantity,
          };
          set((state) => ({
            cartItems: [...state.cartItems, newItem]
          }));
        }
      },

      updateQuantity: (id, quantity) => {
        if (quantity <= 0) {
          set((state) => ({
            cartItems: state.cartItems.filter((item) => item.id !== id)
          }));
          return;
        }

        set((state) => ({
          cartItems: state.cartItems.map((item) =>
            item.id === id ? { ...item, quantity } : item
          )
        }));
      },

      updateUOM: (id, uom, purchasePrice, sellingPrice) => {
        set((state) => ({
          cartItems: state.cartItems.map((item) =>
            item.id === id
              ? {
                  ...item,
                  uom,
                  purchase_price: purchasePrice,
                  selling_price: sellingPrice,
                }
              : item
          )
        }));
      },

      updatePurchasePrice: (id, price) => {
        if (price < 0) {
          toast.error('Price cannot be negative');
          return;
        }
        
        set((state) => ({
          cartItems: state.cartItems.map((item) =>
            item.id === id ? { ...item, purchase_price: price } : item
          )
        }));
      },

      updateSellingPrice: (id, price) => {
        if (price < 0) {
          toast.error('Price cannot be negative');
          return;
        }
        
        set((state) => ({
          cartItems: state.cartItems.map((item) =>
            item.id === id ? { ...item, selling_price: price } : item
          )
        }));
      },

      updateBatch: (id, batch) => {
        set((state) => ({
          cartItems: state.cartItems.map((item) =>
            item.id === id ? { ...item, batch } : item
          )
        }));
      },

      updateSerial: (id, serial) => {
        set((state) => ({
          cartItems: state.cartItems.map((item) =>
            item.id === id ? { ...item, serial } : item
          )
        }));
      },

      removeItem: (id) => {
        set((state) => ({
          cartItems: state.cartItems.filter((item) => item.id !== id)
        }));
      },

      clearCart: () => {
        set(() => ({
          cartItems: [],
          selectedSupplier: null
        }));
      },

      setSelectedSupplier: (supplier) => {
        set(() => ({
          selectedSupplier: supplier
        }));
      },

      getSubtotal: () => {
        const state = get();
        return state.cartItems.reduce(
          (sum, item) => sum + item.purchase_price * item.quantity,
          0
        );
      },

      getItemCount: () => {
        const state = get();
        return state.cartItems.reduce((sum, item) => sum + item.quantity, 0);
      },

      hasChangedPrices: () => {
        const state = get();
        return state.cartItems.some(
          (item) =>
            item.purchase_price !== item.original_purchase_price ||
            item.selling_price !== item.original_selling_price
        );
      },

      getChangedPriceItems: () => {
        const state = get();
        return state.cartItems.filter(
          (item) =>
            item.purchase_price !== item.original_purchase_price ||
            item.selling_price !== item.original_selling_price
        );
      },
    }),
    {
      name: 'klik-purchase-cart-storage'
    }
  )
)
