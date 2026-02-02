import { useEffect, useState, useCallback } from "react";

// Type definitions for payment transactions
export type TransactionType = "in" | "out";
export type TransactionSource = 
  | "sales" 
  | "credit_payment" 
  | "partial_payment" 
  | "return" 
  | "credit_given";

export interface PaymentTransaction {
  id: string;
  type: TransactionType;
  source: TransactionSource;
  payment_mode: string;
  amount: number;
  customer: string;
  customer_id: string;
  reference: string;
  reference_type: "Sales Invoice" | "Payment Entry";
  linked_invoice?: string;
  timestamp: string;
  posting_date: string;
  posting_time: string;
  cashier: string;
  cashier_id: string;
  is_return: boolean;
  status: string;
}

export interface PaymentModeInBreakdown {
  sales: number;
  credit_payments: number;
  partial_payments: number;
  total: number;
}

export interface PaymentModeOutBreakdown {
  returns: number;
  credit_given: number;
  total: number;
}

export interface PaymentModeSummary {
  name: string;
  opening: number;
  in: PaymentModeInBreakdown;
  out: PaymentModeOutBreakdown;
  net: number;
  transactions: number;
}

export interface InvoiceSummary {
  total_invoices: number;
  paid: number;
  unpaid: number;
  returns: number;
  total_sales: number;
  total_returns: number;
  net_sales: number;
}

export interface Cashier {
  user_id: string;
  name: string;
}

export interface PaymentTransactionsResponse {
  success: boolean;
  pos_profile?: string;
  opening_entry?: string;
  date?: string;
  time?: string;
  is_admin?: boolean;
  payment_summary?: Record<string, PaymentModeSummary>;
  transactions?: PaymentTransaction[];
  invoice_summary?: InvoiceSummary;
  cashiers?: Cashier[];
  error?: string;
}

interface UsePaymentTransactionsReturn {
  paymentSummary: Record<string, PaymentModeSummary>;
  transactions: PaymentTransaction[];
  invoiceSummary: InvoiceSummary | null;
  cashiers: Cashier[];
  isAdmin: boolean;
  isLoading: boolean;
  error: string | null;
  posProfile: string | null;
  openingEntry: string | null;
  date: string | null;
  time: string | null;
  refetch: (cashierFilter?: string) => Promise<void>;
}

export function usePaymentTransactions(
  initialCashierFilter?: string
): UsePaymentTransactionsReturn {
  const [paymentSummary, setPaymentSummary] = useState<Record<string, PaymentModeSummary>>({});
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [invoiceSummary, setInvoiceSummary] = useState<InvoiceSummary | null>(null);
  const [cashiers, setCashiers] = useState<Cashier[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [posProfile, setPosProfile] = useState<string | null>(null);
  const [openingEntry, setOpeningEntry] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);

  const fetchTransactions = useCallback(async (cashierFilter?: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (cashierFilter && cashierFilter !== "all") {
        params.append("cashier_filter", cashierFilter);
      }

      const url = `/api/method/klik_pos.api.payment.get_payment_transactions${
        params.toString() ? `?${params.toString()}` : ""
      }`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const result: PaymentTransactionsResponse = data.message;

      if (!result.success) {
        throw new Error(result.error || "Failed to fetch payment transactions");
      }

      setPaymentSummary(result.payment_summary || {});
      setTransactions(result.transactions || []);
      setInvoiceSummary(result.invoice_summary || null);
      setCashiers(result.cashiers || []);
      setIsAdmin(result.is_admin || false);
      setPosProfile(result.pos_profile || null);
      setOpeningEntry(result.opening_entry || null);
      setDate(result.date || null);
      setTime(result.time || null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      console.error("Error fetching payment transactions:", err);
      setError(err.message || "Unknown error occurred");
      setPaymentSummary({});
      setTransactions([]);
      setInvoiceSummary(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchTransactions(initialCashierFilter);
  }, [fetchTransactions, initialCashierFilter]);

  const refetch = useCallback(
    async (cashierFilter?: string) => {
      await fetchTransactions(cashierFilter);
    },
    [fetchTransactions]
  );

  return {
    paymentSummary,
    transactions,
    invoiceSummary,
    cashiers,
    isAdmin,
    isLoading,
    error,
    posProfile,
    openingEntry,
    date,
    time,
    refetch,
  };
}

// Helper functions for filtering and calculations
export function filterTransactionsByType(
  transactions: PaymentTransaction[],
  type: TransactionType | "all"
): PaymentTransaction[] {
  if (type === "all") return transactions;
  return transactions.filter((t) => t.type === type);
}

export function filterTransactionsBySource(
  transactions: PaymentTransaction[],
  source: TransactionSource | "all"
): PaymentTransaction[] {
  if (source === "all") return transactions;
  return transactions.filter((t) => t.source === source);
}

export function filterTransactionsByPaymentMode(
  transactions: PaymentTransaction[],
  mode: string | "all"
): PaymentTransaction[] {
  if (mode === "all") return transactions;
  return transactions.filter((t) => t.payment_mode === mode);
}

export function calculateTotalIn(summary: Record<string, PaymentModeSummary>): number {
  return Object.values(summary).reduce((total, mode) => total + mode.in.total, 0);
}

export function calculateTotalOut(summary: Record<string, PaymentModeSummary>): number {
  return Object.values(summary).reduce((total, mode) => total + mode.out.total, 0);
}

export function calculateTotalNet(summary: Record<string, PaymentModeSummary>): number {
  return Object.values(summary).reduce((total, mode) => total + mode.net, 0);
}

export function calculateTotalOpening(summary: Record<string, PaymentModeSummary>): number {
  return Object.values(summary).reduce((total, mode) => total + mode.opening, 0);
}

export function getSourceLabel(source: TransactionSource): string {
  const labels: Record<TransactionSource, string> = {
    sales: "Sales",
    credit_payment: "Credit Payment",
    partial_payment: "Partial Payment",
    return: "Return",
    credit_given: "Credit Given",
  };
  return labels[source] || source;
}

export function getSourceColor(source: TransactionSource): string {
  const colors: Record<TransactionSource, string> = {
    sales: "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400",
    credit_payment: "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400",
    partial_payment: "bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-400",
    return: "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400",
    credit_given: "bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-400",
  };
  return colors[source] || "bg-gray-100 text-gray-800";
}
