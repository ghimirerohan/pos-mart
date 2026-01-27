/**
 * Purchase Invoice Service
 * Handles API calls for purchase invoice operations.
 */

import { extractErrorMessage } from "../utils/errorExtraction";

/**
 * Get purchase invoice details by invoice name/ID
 */
export async function getPurchaseInvoiceDetails(invoiceName: string) {
  try {
    const response = await fetch(
      `/api/method/klik_pos.api.purchase_invoice.get_purchase_invoice_details?invoice_id=${encodeURIComponent(invoiceName)}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Failed to get purchase invoice details");
    }

    return {
      success: true,
      data: data.message,
    };
  } catch (error: unknown) {
    console.error("Error getting purchase invoice details:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to get purchase invoice details",
    };
  }
}

/**
 * Pay an unpaid purchase invoice
 */
export async function payPurchaseInvoice(
  invoiceName: string,
  modeOfPayment: string,
  amount?: number
) {
  const csrfToken = window.csrf_token;

  const body: { invoice_name: string; mode_of_payment: string; amount?: number } = {
    invoice_name: invoiceName,
    mode_of_payment: modeOfPayment,
  };

  if (amount !== undefined) {
    body.amount = amount;
  }

  const response = await fetch(
    "/api/method/klik_pos.api.purchase_invoice.pay_purchase_invoice",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Frappe-CSRF-Token": csrfToken,
      },
      body: JSON.stringify(body),
      credentials: "include",
    }
  );

  const result = await response.json();

  if (!response.ok || !result.message || result.message.success === false) {
    const errorMessage =
      result.message?.error ||
      (result._server_messages
        ? JSON.parse(result._server_messages)[0]
        : "Failed to process payment");
    throw new Error(errorMessage);
  }

  return result.message;
}

/**
 * Create a return (debit note) for a purchase invoice
 */
export async function returnPurchaseInvoice(invoiceName: string) {
  const csrfToken = window.csrf_token;

  const response = await fetch(
    "/api/method/klik_pos.api.purchase_invoice.return_purchase_invoice",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Frappe-CSRF-Token": csrfToken,
      },
      body: JSON.stringify({ invoice_name: invoiceName }),
      credentials: "include",
    }
  );

  const result = await response.json();

  if (!response.ok || !result.message || result.message.success === false) {
    const serverMsg = result._server_messages
      ? JSON.parse(result._server_messages)[0]
      : result.message?.error || "Failed to return invoice";
    throw new Error(serverMsg);
  }

  return result.message;
}

/**
 * Delete a draft purchase invoice
 */
export async function deleteDraftPurchaseInvoice(invoiceId: string) {
  const csrfToken = window.csrf_token;

  const response = await fetch(
    "/api/method/klik_pos.api.purchase_invoice.delete_draft_purchase_invoice",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Frappe-CSRF-Token": csrfToken,
      },
      body: JSON.stringify({ invoice_id: invoiceId }),
      credentials: "include",
    }
  );

  const result = await response.json();

  if (!response.ok || !result.message || result.message.success === false) {
    const serverMsg = result._server_messages
      ? JSON.parse(result._server_messages)[0]
      : result.message?.error || "Failed to delete invoice";
    throw new Error(serverMsg);
  }

  return result.message;
}
