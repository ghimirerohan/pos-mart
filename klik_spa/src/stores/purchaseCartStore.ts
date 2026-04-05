import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PurchaseCartItem, Supplier } from '../types/supplier'
import { toast } from 'react-toastify'

function newPurchaseRowId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `pr-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

/** Match store actions to the correct cart line (row id preferred over SKU id). */
function lineKeyMatches(item: PurchaseCartItem, key: string): boolean {
  if (item.cart_row_id) return item.cart_row_id === key
  return item.id === key
}

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
  updateBatchExpiryDate: (id: string, batchExpiryDate: string) => void
  updateSerial: (id: string, serial: string) => void
  removeItem: (id: string) => void
  clearCart: () => void
  setSelectedSupplier: (supplier: Supplier | null) => void
  setItemSupplier: (id: string, supplier: Supplier | null) => void
  copySupplierFromAbove: (id: string) => void
  
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
        const defaultSup =
          state.selectedSupplier &&
          ({
            id: state.selectedSupplier.id,
            supplier_name: state.selectedSupplier.supplier_name,
          } as const);

        if (existingItem) {
          set((state) => ({
            cartItems: state.cartItems.map((cartItem) =>
              cartItem.id === item.id
                ? { ...cartItem, quantity: cartItem.quantity + 1 }
                : cartItem
            ),
          }));
        } else {
          const newItem: PurchaseCartItem = {
            ...item,
            cart_row_id: item.cart_row_id ?? newPurchaseRowId(),
            quantity: 1,
            supplier: item.supplier ?? defaultSup ?? null,
          };
          set((state) => ({
            cartItems: [...state.cartItems, newItem],
          }));
        }
      },

      addToCartWithQuantity: (item, quantity) => {
        const state = get();
        const existingItem = state.cartItems.find((cartItem) => cartItem.id === item.id);
        const defaultSup =
          state.selectedSupplier &&
          ({
            id: state.selectedSupplier.id,
            supplier_name: state.selectedSupplier.supplier_name,
          } as const);

        if (existingItem) {
          set((state) => ({
            cartItems: state.cartItems.map((cartItem) =>
              cartItem.id === item.id
                ? { ...cartItem, quantity: cartItem.quantity + quantity }
                : cartItem
            ),
          }));
        } else {
          const newItem: PurchaseCartItem = {
            ...item,
            cart_row_id: item.cart_row_id ?? newPurchaseRowId(),
            quantity,
            supplier: item.supplier ?? defaultSup ?? null,
          };
          set((state) => ({
            cartItems: [...state.cartItems, newItem],
          }));
        }
      },

      updateQuantity: (id, quantity) => {
        if (quantity <= 0) {
          set((state) => ({
            cartItems: state.cartItems.filter((item) => !lineKeyMatches(item, id))
          }));
          return;
        }

        set((state) => ({
          cartItems: state.cartItems.map((item) =>
            lineKeyMatches(item, id) ? { ...item, quantity } : item
          )
        }));
      },

      updateUOM: (id, uom, purchasePrice, sellingPrice) => {
        set((state) => ({
          cartItems: state.cartItems.map((item) =>
            lineKeyMatches(item, id)
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
            lineKeyMatches(item, id) ? { ...item, purchase_price: price } : item
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
            lineKeyMatches(item, id) ? { ...item, selling_price: price } : item
          )
        }));
      },

      updateBatch: (id, batch) => {
        set((state) => ({
          cartItems: state.cartItems.map((item) =>
            lineKeyMatches(item, id) ? { ...item, batch } : item
          )
        }));
      },

      updateBatchExpiryDate: (id, batchExpiryDate) => {
        set((state) => ({
          cartItems: state.cartItems.map((item) =>
            lineKeyMatches(item, id) ? { ...item, batch_expiry_date: batchExpiryDate } : item
          )
        }));
      },

      updateSerial: (id, serial) => {
        set((state) => ({
          cartItems: state.cartItems.map((item) =>
            lineKeyMatches(item, id) ? { ...item, serial } : item
          )
        }));
      },

      removeItem: (id) => {
        set((state) => ({
          cartItems: state.cartItems.filter((item) => !lineKeyMatches(item, id))
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
          selectedSupplier: supplier,
        }));
      },

      setItemSupplier: (id, supplier) => {
        const snap = supplier
          ? { id: supplier.id, supplier_name: supplier.supplier_name }
          : null;
        set((state) => ({
          cartItems: state.cartItems.map((it) =>
            lineKeyMatches(it, id) ? { ...it, supplier: snap } : it
          ),
        }));
      },

      copySupplierFromAbove: (id) => {
        const { cartItems } = get();
        const idx = cartItems.findIndex((it) => lineKeyMatches(it, id));
        if (idx <= 0) return;
        const above = cartItems[idx - 1];
        if (!above?.supplier?.id) return;
        set((state) => ({
          cartItems: state.cartItems.map((it) =>
            lineKeyMatches(it, id)
              ? {
                  ...it,
                  supplier: {
                    id: above.supplier!.id,
                    supplier_name: above.supplier!.supplier_name,
                  },
                }
              : it
          ),
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
      name: 'klik-purchase-cart-storage',
      version: 2,
      merge: (persistedState, currentState) => {
        const merged = {
          ...currentState,
          ...(persistedState as Partial<PurchaseCartState>),
        }
        if (merged.cartItems?.length) {
          merged.cartItems = merged.cartItems.map((it) => ({
            ...it,
            cart_row_id: it.cart_row_id ?? newPurchaseRowId(),
          }))
        }
        return merged
      },
    }
  )
)
