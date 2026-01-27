import { useState, useEffect } from "react";
import type { PurchaseInvoice } from "../../types";

export function usePurchaseInvoiceDetails(invoiceId: string | null) {
  const [invoice, setInvoice] = useState<PurchaseInvoice | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!invoiceId) return;

    const fetchInvoice = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(
          `/api/method/klik_pos.api.purchase_invoice.get_purchase_invoice_details?invoice_id=${invoiceId}`,
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
            resData.message?.error || resData.error || "Failed to fetch invoice"
          );
        }

        setInvoice(resData.message.data);
      } catch (err: unknown) {
        console.error("Error fetching purchase invoice details:", err);
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("Unknown error");
        }
      } finally {
        setIsLoading(false);
      }
    };

    fetchInvoice();
  }, [invoiceId]);

  return { invoice, isLoading, error };
}
