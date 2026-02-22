
import { extractErrorMessage } from "../utils/errorExtraction";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createDraftSalesInvoice(data: any) {
const csrfToken = window.csrf_token;
  const response = await fetch('/api/method/klik_pos.api.sales_invoice.create_draft_invoice', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Frappe-CSRF-Token': csrfToken
    },
    body: JSON.stringify({ data }),
    credentials: 'include'
  });

  const result = await response.json();

  if (!response.ok || !result.message || result.message.success === false) {
    const errorMessage = extractErrorMessage(result, 'Failed to create invoice');
    throw new Error(errorMessage);
  }

  return result.message;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createSalesInvoice(data: any) {
  const csrfToken = window.csrf_token;

  const response = await fetch('/api/method/klik_pos.api.sales_invoice.create_and_submit_invoice', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Frappe-CSRF-Token': csrfToken
    },
    body: JSON.stringify({ data }),
    credentials: 'include'
  });

  const result = await response.json();

  if (!response.ok || !result.message || result.message.success === false) {
    console.error('Invoice creation error:', result);
    const errorMessage = extractErrorMessage(result, result.message?.message || result.message?.error || 'Failed to create invoice');
    throw new Error(errorMessage);
  }

  // Collect non-fatal server warnings (e.g. negative-stock notices when
  // Allow Negative Stock is enabled).  Attach them to the response so the
  // caller can display them as informational toasts instead of error toasts.
  const warnings: string[] = [];
  if (result._server_messages) {
    try {
      const msgs: unknown[] = JSON.parse(result._server_messages);
      for (const raw of msgs) {
        if (typeof raw === 'string') {
          try {
            const parsed = JSON.parse(raw);
            if (parsed?.message) warnings.push(parsed.message);
          } catch { warnings.push(raw); }
        }
      }
    } catch { /* ignore unparseable */ }
  }

  return { ...result.message, _warnings: warnings };
}

export async function createSalesReturn(invoiceName: string) {
  const csrfToken = window.csrf_token;

  const response = await fetch('/api/method/klik_pos.api.sales_invoice.return_sales_invoice', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Frappe-CSRF-Token': csrfToken
    },
    body: JSON.stringify({ invoice_name: invoiceName }),
    credentials: 'include'
  });

  const result = await response.json();
  console.log("Return Invoice result:", result);

  if (!response.ok || !result.message || result.message.success === false) {
    const serverMsg = result._server_messages
      ? JSON.parse(result._server_messages)[0]
      : result.message?.message || 'Failed to return invoice';
    throw new Error(serverMsg);
  }

  return result.message;
}

export async function getInvoiceDetails(invoiceName: string) {
  try {
    // console.log('Fetching invoice details for:', invoiceName);
    const response = await fetch(`/api/method/klik_pos.api.sales_invoice.get_invoice_details?invoice_id=${invoiceName}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include'
    });

    const data = await response.json();
    // console.log('Invoice details response:', data);

    if (!response.ok) {
      throw new Error(data.message || 'Failed to get invoice details');
    }

    return {
      success: true,
      data: data.message
    };
          //eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    console.error('Error getting invoice details:', error);
    return {
      success: false,
      error: error.message || 'Failed to get invoice details'
    };
  }
}

export async function deleteDraftInvoice(invoiceId: string) {
  const csrfToken = window.csrf_token;

  const response = await fetch('/api/method/klik_pos.api.sales_invoice.delete_draft_invoice', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Frappe-CSRF-Token': csrfToken
    },
    body: JSON.stringify({ invoice_id: invoiceId }),
    credentials: 'include'
  });

  const result = await response.json();
  // console.log("Delete invoice result:", result);

  if (!response.ok || !result.message || result.message.success === false) {
    const serverMsg = result._server_messages
      ? JSON.parse(result._server_messages)[0]
      : result.message?.error || 'Failed to delete invoice';
    throw new Error(serverMsg);
  }

  return result.message;
}

export async function getDraftInvoiceItems(invoiceId: string) {
  const response = await fetch(`/api/method/klik_pos.api.sales_invoice.get_invoice_details?invoice_id=${invoiceId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include'
  });

  const result = await response.json();
  // console.log("Draft invoice items result:", result);

  if (!response.ok || !result.message) {
    const errorMessage = extractErrorMessage(result, result.message?.error || 'Failed to fetch draft invoice items');
    throw new Error(errorMessage);
  }

  // The backend returns { success: true, data: { ... } }
  // We need to return the data part
  if (result.message.success && result.message.data) {
    return result.message.data;
  } else {
    throw new Error(result.message.error || 'Failed to fetch draft invoice items');
  }
}

export async function submitDraftInvoice(invoiceId: string) {
  const csrfToken = window.csrf_token;

  const response = await fetch('/api/method/klik_pos.api.sales_invoice.submit_draft_invoice', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Frappe-CSRF-Token': csrfToken
    },
    body: JSON.stringify({ invoice_id: invoiceId }),
    credentials: 'include'
  });

  const result = await response.json();
  console.log("Submit draft invoice result:", result);

  if (!response.ok || !result.message || result.message.success === false) {
    const errorMessage = extractErrorMessage(result, result.message?.error || 'Failed to submit draft invoice');
    throw new Error(errorMessage);
  }

  return result.message;
}

export async function payUnpaidInvoice(invoiceName: string, modeOfPayment: string, amount?: number) {
  const csrfToken = window.csrf_token;

  const body: { invoice_name: string; mode_of_payment: string; amount?: number } = {
    invoice_name: invoiceName,
    mode_of_payment: modeOfPayment,
  };
  
  if (amount !== undefined) {
    body.amount = amount;
  }

  const response = await fetch('/api/method/klik_pos.api.sales_invoice.pay_unpaid_invoice', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Frappe-CSRF-Token': csrfToken
    },
    body: JSON.stringify(body),
    credentials: 'include'
  });

  const result = await response.json();

  if (!response.ok || !result.message || result.message.success === false) {
    const errorMessage = result.message?.error || (result._server_messages 
      ? JSON.parse(result._server_messages)[0] 
      : 'Failed to process payment');
    throw new Error(errorMessage);
  }

  return result.message;
}

export async function getInvoicePaymentStatus(invoiceName: string) {
  try {
    const response = await fetch(`/api/method/klik_pos.api.sales_invoice.get_invoice_payment_status?invoice_name=${encodeURIComponent(invoiceName)}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include'
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Failed to get invoice payment status');
    }

    return {
      success: true,
      data: data.message
    };
  } catch (error) {
    console.error('Error getting invoice payment status:', error);
    return {
      success: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      error: (error as any).message || 'Failed to get invoice payment status'
    };
  }
}

export async function updateInvoiceOutstanding(invoiceName: string) {
  const csrfToken = window.csrf_token;

  try {
    const response = await fetch('/api/method/klik_pos.api.sales_invoice.update_invoice_outstanding', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Frappe-CSRF-Token': csrfToken
      },
      body: JSON.stringify({ invoice_name: invoiceName }),
      credentials: 'include'
    });

    const result = await response.json();

    if (!response.ok || !result.message || result.message.success === false) {
      const errorMessage = result.message?.error || 'Failed to update invoice outstanding';
      throw new Error(errorMessage);
    }

    return result.message;
  } catch (error) {
    console.error('Error updating invoice outstanding:', error);
    return {
      success: false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      error: (error as any).message || 'Failed to update invoice outstanding'
    };
  }
}
