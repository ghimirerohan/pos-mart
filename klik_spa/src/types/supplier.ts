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
  id: string
  item_code: string
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
  
  // Batch/Serial tracking
  batch?: string
  serial?: string
  
  // Display fields
  currency_symbol?: string
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
