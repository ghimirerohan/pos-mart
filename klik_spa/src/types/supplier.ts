/**
 * Supplier types for KLiK POS Purchase Module
 */

export interface Supplier {
  id: string
  name: string
  supplier_name: string
  supplier_type: 'Company' | 'Individual'
  supplier_group: string
  country: string
  contact?: {
    first_name?: string
    last_name?: string
    email_id?: string
    phone?: string
    mobile_no?: string
  }
  address?: {
    address_line1?: string
    city?: string
    state?: string
    country?: string
    pincode?: string
  }
  // Statistics
  total_orders: number
  total_spent: number
  last_purchase?: string
}

export interface SupplierGroup {
  name: string
  supplier_group_name: string
}

export interface CreateSupplierData {
  supplier_name: string
  contact_name?: string
  email?: string
  phone?: string
  supplier_group?: string
  supplier_type?: 'Company' | 'Individual'
  country?: string
  address?: {
    addressType?: string
    street?: string
    city?: string
    state?: string
    zipCode?: string
    country?: string
  }
}

/**
 * Purchase Cart Item - extends base cart item with purchase-specific fields
 */
export interface PurchaseCartItem {
  /** ERP item code (same as legacy `id` for API payloads). */
  id: string
  item_code: string
  /**
   * Stable row identity for the purchase cart. `id` is the SKU; multiple lines
   * of the same SKU (future) or bad data must not share one supplier update.
   */
  cart_row_id?: string
  name: string
  category: string
  image: string
  quantity: number
  uom: string
  base_uom?: string
  conversion_factor?: number
  
  // Purchase-specific prices (editable)
  purchase_price: number
  selling_price: number
  
  // Original prices for comparison (to determine if changed)
  original_purchase_price: number
  original_selling_price: number
  
  // Batch/Serial tracking (batch from item master; optional line overrides for this GRN)
  batch?: string
  /** Expiry date for this purchase line (YYYY-MM-DD); used when creating a new batch */
  batch_expiry_date?: string
  serial?: string
  /** Copied from product list when adding to cart */
  has_batch_no?: number
  has_expiry_date?: number
  shelf_life_in_days?: number | null
  
  // Display fields
  currency_symbol?: string

  /** Per-line supplier (required at checkout). New lines copy `selectedSupplier` from store when set. */
  supplier?: { id: string; supplier_name: string } | null
}

/**
 * Purchase Invoice types
 */
export interface PurchaseInvoice {
  name: string
  supplier: string
  supplier_name: string
  posting_date: string
  posting_time?: string
  status: string
  base_grand_total: number
  currency: string
  is_paid: boolean
  update_stock: boolean
  items: PurchaseInvoiceItem[]
}

export interface PurchaseInvoiceItem {
  item_code: string
  item_name?: string
  qty: number
  rate: number
  amount: number
}

export interface CreatePurchaseInvoiceData {
  supplier: {
    id: string
  }
  items: Array<{
    id: string
    quantity: number
    purchase_price: number
    selling_price: number
    original_purchase_price: number
    original_selling_price: number
    uom?: string
    batch?: string
    serial?: string
    expiry_date?: string
    batch_expiry_date?: string
  }>
  paymentMethods: Array<{
    mode_of_payment: string
    amount: number
  }>
  isCreditPurchase: boolean
  taxTemplate?: string
  attachment?: {
    file_url?: string
    file_content?: string
    file_name?: string
  }
}

export interface PurchaseInvoiceResponse {
  success: boolean
  invoice_name?: string
  /** When multiple PIs are created in one flow */
  invoice_names?: string[]
  invoice_id?: string
  invoice?: PurchaseInvoice
  payment_entry?: string
  price_updates?: Array<{
    item_code: string
    buying_updated: boolean
    selling_updated: boolean
  }>
  attachment?: {
    success: boolean
    file_name?: string
    file_url?: string
  }
  error?: string
  message?: string
}
