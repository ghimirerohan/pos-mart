import { useEffect, useState, useCallback } from "react";
import type { PurchaseInvoice, PurchaseInvoiceItem } from "../../types";

export function usePurchaseInvoices(
  searchTerm: string = "",
  userName?: string
) {
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalLoaded, setTotalLoaded] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  const LIMIT = 100;

  // Debounced search term state
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState(searchTerm);

  // Debounce search term to prevent excessive API calls
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  const fetchInvoices = useCallback(
    async (page = 0, append = false) => {
      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
      }

      try {
        const start = page * LIMIT;

        const searchParam = debouncedSearchTerm
          ? `&search=${encodeURIComponent(debouncedSearchTerm)}`
          : "";
        // Filter by user name if provided
        const userParam =
          userName && userName !== "all"
            ? `&user_name=${encodeURIComponent(userName)}`
            : "";
        const response = await fetch(
          `/api/method/klik_pos.api.purchase_invoice.get_purchase_invoices?limit=${LIMIT}&start=${start}${searchParam}${userParam}`,
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            credentials: "include",
          }
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const resData = await response.json();
        if (!resData.message || !resData.message.success) {
          throw new Error(
            resData.message?.error || resData.error || "Failed to fetch invoices"
          );
        }

        const rawInvoices = resData.message.data;
        const newInvoicesCount = rawInvoices.length;
        const totalCountFromAPI = resData.message.total_count || 0;

        // Check if we have more invoices to load
        setHasMore(newInvoicesCount === LIMIT);
        setTotalCount(totalCountFromAPI);

        const transformed: PurchaseInvoice[] = rawInvoices.map(
          (invoice: Record<string, unknown>) => {
            const status = invoice.status as string;
            const items: PurchaseInvoiceItem[] = Array.isArray(
              (invoice as { items?: unknown[] }).items
            )
              ? ((invoice as { items: unknown[] }).items as PurchaseInvoiceItem[])
              : [];

            let canReturn = true;

            if (status === "Debit Note Issued") {
              const itemsWithAvailableQty = items.filter(
                (item: PurchaseInvoiceItem & { available_qty?: number }) =>
                  (item.available_qty || 0) > 0
              );
              canReturn = itemsWithAvailableQty.length > 0;
            } else {
              // For all other invoices, show return button by default
              canReturn = true;
            }

            return {
              id: invoice.name as string,
              name: invoice.name as string,
              date: (invoice.posting_date as string) || new Date().toISOString().split("T")[0],
              time: (invoice.posting_time as string) || "00:00:00",
              user: (invoice.user_name as string) || "",
              userId: (invoice.owner as string) || "",
              supplier: (invoice.supplier_name as string) || "",
              supplierId: (invoice.supplier as string) || "",
              items: items,
              subtotal:
                (Number(invoice.base_grand_total) || 0) -
                (Number(invoice.total_taxes_and_charges) || 0) +
                (Number(invoice.discount_amount) || 0),
              discountAmount: Number(invoice.discount_amount) || 0,
              taxAmount: Number(invoice.total_taxes_and_charges) || 0,
              totalAmount: Number(invoice.base_grand_total) || 0,
              paymentMethod: (invoice.mode_of_payment as string) || "-",
              payment_methods: (invoice.payment_methods as Array<{
                mode_of_payment: string;
                amount: number;
              }>) || [],
              outstandingAmount: Number(invoice.outstanding_amount) || 0,
              paidAmount: Number(invoice.paid_amount) || 0,
              status: (status as
                | "Draft"
                | "Unpaid"
                | "Partly Paid"
                | "Paid"
                | "Overdue"
                | "Cancelled"
                | "Return"
                | "Debit Note Issued") || "Draft",
              currency: (invoice.currency as string) || "USD",
              company: (invoice.company as string) || "",
              isReturn: Boolean(invoice.is_return),
              returnAgainst: (invoice.return_against as string) || "",
              canReturn: canReturn,
            };
          }
        );

        if (append) {
          setInvoices((prev) => [...prev, ...transformed]);
          setTotalLoaded((prev) => prev + newInvoicesCount);
        } else {
          setInvoices(transformed);
          setTotalLoaded(newInvoicesCount);
        }

        setCurrentPage(page);
        setError(null);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Unknown error occurred");
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [debouncedSearchTerm, userName]
  );

  const loadMore = useCallback(() => {
    if (!isLoadingMore && hasMore) {
      fetchInvoices(currentPage + 1, true);
    }
  }, [currentPage, isLoadingMore, hasMore, fetchInvoices]);

  const refetch = useCallback(() => {
    setCurrentPage(0);
    setTotalLoaded(0);
    setHasMore(true);
    fetchInvoices(0, false);
  }, [fetchInvoices]);

  // Initial load and refetch when debounced search term changes
  useEffect(() => {
    setCurrentPage(0);
    setTotalLoaded(0);
    setHasMore(true);
    fetchInvoices(0, false);
  }, [debouncedSearchTerm, fetchInvoices]);

  // Auto-load all invoices if total count is reasonable (for better client-side filtering)
  useEffect(() => {
    if (
      !isLoading &&
      !isLoadingMore &&
      totalCount > 0 &&
      totalCount <= 1000 &&
      hasMore
    ) {
      const remainingPages = Math.ceil((totalCount - totalLoaded) / LIMIT);
      if (remainingPages > 0 && remainingPages <= 10) {
        const loadAllPages = async () => {
          for (let page = currentPage + 1; page <= currentPage + remainingPages; page++) {
            if (!hasMore) break;
            await fetchInvoices(page, true);
          }
        };
        loadAllPages();
      }
    }
  }, [
    totalCount,
    totalLoaded,
    hasMore,
    isLoading,
    isLoadingMore,
    currentPage,
    fetchInvoices,
  ]);

  return {
    invoices,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    totalLoaded,
    totalCount,
    loadMore,
    refetch,
  };
}
