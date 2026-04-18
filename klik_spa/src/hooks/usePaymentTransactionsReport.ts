import { useEffect, useState, useCallback } from "react";
import type {
  PaymentTransactionsResponse,
  PaymentModeSummary,
  PaymentTransaction,
  InvoiceSummary,
  Cashier,
} from "./usePaymentTransactions";

interface UsePaymentTransactionsReportReturn {
  paymentSummary: Record<string, PaymentModeSummary>;
  transactions: PaymentTransaction[];
  invoiceSummary: InvoiceSummary | null;
  cashiers: Cashier[];
  isLoading: boolean;
  error: string | null;
  posProfile: string | null;
  fromDate: string | null;
  toDate: string | null;
  totalCreditGiven: number;
  refetch: () => Promise<void>;
}

/**
 * Administrator-only POS payment report for a posting date range (read-only).
 */
export function usePaymentTransactionsReport(
  fromDate: string,
  toDate: string,
  cashierFilter?: string
): UsePaymentTransactionsReportReturn {
  const [paymentSummary, setPaymentSummary] = useState<Record<string, PaymentModeSummary>>({});
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [invoiceSummary, setInvoiceSummary] = useState<InvoiceSummary | null>(null);
  const [cashiers, setCashiers] = useState<Cashier[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [posProfile, setPosProfile] = useState<string | null>(null);
  const [fromDateOut, setFromDateOut] = useState<string | null>(null);
  const [toDateOut, setToDateOut] = useState<string | null>(null);
  const [totalCreditGiven, setTotalCreditGiven] = useState(0);

  const fetchReport = useCallback(async () => {
    if (!fromDate || !toDate) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        from_date: fromDate,
        to_date: toDate,
        cashier_filter: cashierFilter ?? "current_cashier",
      });

      const url = `/api/method/klik_pos.api.payment.get_payment_transactions_report?${params.toString()}`;
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
        throw new Error(result.error || "Failed to load report");
      }

      setPaymentSummary(result.payment_summary || {});
      setTransactions(result.transactions || []);
      setInvoiceSummary(result.invoice_summary || null);
      setCashiers(result.cashiers || []);
      setPosProfile(result.pos_profile || null);
      setFromDateOut((result as { from_date?: string }).from_date || fromDate);
      setToDateOut((result as { to_date?: string }).to_date || toDate);
      setTotalCreditGiven(result.total_credit_given || 0);
    } catch (err: unknown) {
      console.error("Error fetching payment report:", err);
      const message = err instanceof Error ? err.message : "Unknown error occurred";
      setError(message);
      setPaymentSummary({});
      setTransactions([]);
      setInvoiceSummary(null);
    } finally {
      setIsLoading(false);
    }
  }, [fromDate, toDate, cashierFilter]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  return {
    paymentSummary,
    transactions,
    invoiceSummary,
    cashiers,
    isLoading,
    error,
    posProfile,
    fromDate: fromDateOut,
    toDate: toDateOut,
    totalCreditGiven,
    refetch: fetchReport,
  };
}
