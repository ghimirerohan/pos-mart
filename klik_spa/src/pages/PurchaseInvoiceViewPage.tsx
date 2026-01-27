import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";

import {
  ArrowLeft,
  Printer,
  DollarSign,
  FileText,
  CheckCircle,
  AlertTriangle,
  RotateCcw,
  FileMinus,
  Package,
  Building2,
  Phone,
  Mail,
  MapPin,
  Percent,
} from "lucide-react";

import MakePaymentModal from "../components/MakePaymentModal";
import { usePurchaseInvoiceDetails } from "../hooks/usePurchaseInvoiceDetails";
import { usePOSDetails } from "../hooks/usePOSProfile";
import { deleteDraftPurchaseInvoice, returnPurchaseInvoice } from "../services/purchaseInvoice";
import { toast } from "react-toastify";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { formatCurrency } from "../utils/currency";

export default function PurchaseInvoiceViewPage() {
  const { id } = useParams();
  const invoiceId = id ?? "";

  const { invoice, isLoading, error } = usePurchaseInvoiceDetails(invoiceId);
  const { posDetails } = usePOSDetails();
  const navigate = useNavigate();

  // Delete confirmation state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Make Payment modal state
  const [showMakePaymentModal, setShowMakePaymentModal] = useState(false);

  const handleBackClick = () => {
    navigate(`/purchase-invoice`);
  };

  // Delete invoice handlers
  const handleDeleteClick = () => {
    if (!invoice) return;
    if (invoice.status !== "Draft") {
      toast.error("Only draft invoices can be deleted");
      return;
    }
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = async () => {
    if (!invoice) return;

    try {
      await deleteDraftPurchaseInvoice(invoice.name || invoice.id);
      toast.success(`Draft invoice ${invoice.name || invoice.id} deleted successfully`);
      setShowDeleteConfirm(false);
      navigate("/purchase-invoice");
    } catch (error: unknown) {
      console.error("Delete error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to delete invoice");
    }
  };

  const handleDeleteCancel = () => {
    setShowDeleteConfirm(false);
  };

  const getStatusBadge = (status: string) => {
    const baseClasses = "px-3 py-1 rounded-full text-sm font-medium flex items-center space-x-1";
    switch (status) {
      case "Paid":
        return `${baseClasses} bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400`;
      case "Unpaid":
        return `${baseClasses} bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400`;
      case "Partly Paid":
        return `${baseClasses} bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-400`;
      case "Overdue":
        return `${baseClasses} bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400`;
      case "Draft":
        return `${baseClasses} bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400`;
      case "Cancelled":
        return `${baseClasses} bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400`;
      case "Return":
      case "Debit Note Issued":
        return `${baseClasses} bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-400`;
      default:
        return baseClasses;
    }
  };

  const handleReturnClick = async () => {
    if (!invoice) return;
    try {
      const result = await returnPurchaseInvoice(invoice.name || invoice.id);
      navigate(`/purchase-invoice/${result.return_invoice}`);
      toast.success(`Return invoice created: ${result.return_invoice}`);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to return invoice");
    }
  };

  // Helper function to check if invoice has items that can still be returned
  const hasReturnableItems = () => {
    if (!invoice || !invoice.items) return false;

    return invoice.items.some((item) => {
      const soldQty = item.qty || item.quantity || 0;
      const returnedQty = item.returned_qty || 0;
      return returnedQty < soldQty;
    });
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex">
        <div className="flex-1 flex items-center justify-center ml-20">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600 dark:text-gray-400">Loading invoice...</p>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex">
        <div className="flex-1 flex items-center justify-center ml-20">
          <div className="text-center">
            <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <p className="text-red-600 dark:text-red-400">Error loading invoice: {error}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  // No invoice found
  if (!invoice) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex">
        <div className="flex-1 flex items-center justify-center ml-20">
          <div className="text-center">
            <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600 dark:text-gray-400">Invoice not found</p>
          </div>
        </div>
      </div>
    );
  }

  // Get outstanding amount from invoice
  const outstandingAmount = invoice.outstanding_amount || invoice.outstandingAmount || 0;
  const invoiceCurrency = invoice.currency || posDetails?.currency || "USD";

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex pb-12">
      <div className="flex-1 flex flex-col overflow-hidden ml-20">
        {/* Header */}
        <div className="fixed top-0 left-20 right-0 z-50 bg-beveren-50 dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <button
                  onClick={handleBackClick}
                  className="p-2 text-gray-600 dark:text-gray-400 hover:bg-beveren-200 dark:hover:bg-gray-700 rounded-lg"
                >
                  <ArrowLeft size={20} />
                </button>
                <div>
                  <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                    Invoice {invoice.name || invoice.id}
                  </h1>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {invoice.posting_date || invoice.date} at {invoice.posting_time || invoice.time}
                  </p>
                </div>
                <div className={getStatusBadge(invoice.status)}>
                  <CheckCircle size={16} />
                  <span>{invoice.status}</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center space-x-3">
                <button
                  className="group relative p-2 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-all duration-200"
                  onClick={() => window.print()}
                >
                  <Printer size={20} />
                  <span className="absolute top-full left-1/2 transform -translate-x-1/2 mt-0.5 px-2 py-1 text-xs text-gray-600 dark:text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-50">
                    Print Invoice
                  </span>
                </button>

                {/* Return Button */}
                {["Paid", "Unpaid", "Overdue", "Partly Paid", "Debit Note Issued"].includes(invoice.status) &&
                  !invoice.is_return &&
                  !invoice.isReturn &&
                  hasReturnableItems() && (
                    <>
                      <div className="w-px h-6 bg-gray-300 dark:bg-gray-600"></div>
                      <button
                        className="group relative p-2 text-orange-600 hover:bg-orange-100 dark:text-orange-400 dark:hover:bg-orange-900 rounded-lg transition-all duration-200"
                        onClick={handleReturnClick}
                      >
                        <RotateCcw size={20} />
                        <span className="absolute top-full left-1/2 transform -translate-x-1/2 mt-0.5 px-2 py-1 text-xs text-gray-600 dark:text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-50">
                          Return Invoice
                        </span>
                      </button>
                    </>
                  )}

                {/* Delete Button for Draft Invoices */}
                {invoice.status === "Draft" && (
                  <>
                    <div className="w-px h-6 bg-gray-300 dark:bg-gray-600"></div>
                    <button
                      className="group relative p-2 text-red-600 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900 rounded-lg transition-all duration-200"
                      onClick={handleDeleteClick}
                    >
                      <FileMinus size={20} />
                      <span className="absolute top-full left-1/2 transform -translate-x-1/2 mt-0.5 px-2 py-1 text-xs text-gray-600 dark:text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-50">
                        Delete Draft Invoice
                      </span>
                    </button>
                  </>
                )}

                {/* Make Payment Button for Unpaid Invoices */}
                {["Unpaid", "Overdue", "Partly Paid"].includes(invoice.status) && outstandingAmount > 0 && (
                  <>
                    <div className="w-px h-6 bg-gray-300 dark:bg-gray-600"></div>
                    <button
                      className="group relative p-2 text-green-600 hover:bg-green-100 dark:text-green-400 dark:hover:bg-green-900 rounded-lg transition-all duration-200"
                      onClick={() => setShowMakePaymentModal(true)}
                    >
                      <DollarSign size={20} />
                      <span className="absolute top-full left-1/2 transform -translate-x-1/2 mt-0.5 px-2 py-1 text-xs text-gray-600 dark:text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-50">
                        Make Payment
                      </span>
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 pt-20 pb-20 overflow-auto">
          <div className="max-w-7xl mx-auto px-6 py-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Invoice Details - 70% */}
              <div className="lg:col-span-2">
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                  {/* Invoice Header */}
                  <div className="px-6 py-4 bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
                    <div className="flex justify-between items-start">
                      <div>
                        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">PURCHASE INVOICE</h2>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">#{invoice.name || invoice.id}</p>
                      </div>
                      <div className="text-right">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{invoice.company}</h3>
                        {invoice.company_address_doc && (
                          <>
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                              {invoice.company_address_doc.address_line1}
                            </p>
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                              {invoice.company_address_doc.city}
                            </p>
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                              {invoice.company_address_doc.phone}
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Invoice Info */}
                  <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-600">
                    <div className="grid grid-cols-2 gap-8">
                      <div>
                        <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-2">Supplier:</h4>
                        <p className="text-sm text-gray-900 dark:text-white font-medium">
                          {invoice.supplier_name || invoice.supplier}
                        </p>
                        {invoice.supplier_address_doc && (
                          <>
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                              {invoice.supplier_address_doc.address_line1}
                            </p>
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                              {invoice.supplier_address_doc.email_id}
                            </p>
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                              {invoice.supplier_address_doc.phone}
                            </p>
                          </>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="space-y-2">
                          <div className="flex justify-between">
                            <span className="text-sm text-gray-600 dark:text-gray-400">Date:</span>
                            <span className="text-sm text-gray-900 dark:text-white">
                              {invoice.posting_date || invoice.date}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-sm text-gray-600 dark:text-gray-400">Time:</span>
                            <span className="text-sm text-gray-900 dark:text-white">
                              {invoice.posting_time || invoice.time}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-sm text-gray-600 dark:text-gray-400">User:</span>
                            <span className="text-sm text-gray-900 dark:text-white">
                              {invoice.user_name || invoice.user || invoice.owner}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-sm text-gray-600 dark:text-gray-400">Payment:</span>
                            <span className="text-sm text-gray-900 dark:text-white">
                              {invoice.mode_of_payment || invoice.paymentMethod || "-"}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Items Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 dark:bg-gray-700">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Item
                          </th>
                          <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Qty
                          </th>
                          <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Rate
                          </th>
                          <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Total
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
                        {invoice.items?.map((item, index) => (
                          <tr key={index}>
                            <td className="px-6 py-4">
                              <div>
                                <div className="text-sm font-medium text-gray-900 dark:text-white">
                                  {item.item_name}
                                </div>
                                <div className="text-sm text-gray-500 dark:text-gray-400">Code: {item.item_code}</div>
                              </div>
                            </td>
                            <td className="px-6 py-4 text-center text-sm text-gray-900 dark:text-white">
                              {item.qty}
                            </td>
                            <td className="px-6 py-4 text-right text-sm text-gray-900 dark:text-white">
                              {formatCurrency(item.rate, invoiceCurrency)}
                            </td>
                            <td className="px-6 py-4 text-right text-sm font-medium text-gray-900 dark:text-white">
                              {formatCurrency(item.amount, invoiceCurrency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Tax Details Section */}
                  {invoice.taxes && invoice.taxes.length > 0 && (
                    <div className="px-6 py-4 bg-beveren-50 dark:bg-beveren-900/20 border-t border-gray-200 dark:border-gray-600">
                      <div className="flex items-center space-x-2 mb-3">
                        <Percent className="w-5 h-5 text-beveren-600 dark:text-beveren-400" />
                        <h4 className="text-sm font-semibold text-beveren-900 dark:text-beveren-100">Tax Details</h4>
                      </div>
                      <div className="space-y-2">
                        {invoice.taxes.map((tax, index) => (
                          <div key={index} className="flex justify-between items-center text-sm">
                            <div className="flex items-center space-x-2">
                              <span className="text-gray-700 dark:text-gray-300">{tax.description}</span>
                              {tax.rate && (
                                <span className="px-2 py-0.5 bg-beveren-100 dark:bg-beveren-800 text-beveren-700 dark:text-beveren-300 rounded text-xs">
                                  {tax.rate}%
                                </span>
                              )}
                            </div>
                            <span className="font-medium text-gray-900 dark:text-white">
                              {formatCurrency(tax.tax_amount, invoiceCurrency)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Totals */}
                  <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-600">
                    <div className="flex flex-col items-end space-y-2">
                      <div className="flex justify-between w-64">
                        <span className="text-sm text-gray-600 dark:text-gray-400">Subtotal:</span>
                        <span className="text-sm text-gray-900 dark:text-white">
                          {formatCurrency(
                            (invoice.base_grand_total || invoice.grand_total || invoice.totalAmount || 0) -
                              (invoice.total_taxes_and_charges || invoice.taxAmount || 0),
                            invoiceCurrency
                          )}
                        </span>
                      </div>
                      {(invoice.total_taxes_and_charges || invoice.taxAmount || 0) > 0 && (
                        <div className="flex justify-between w-64">
                          <span className="text-sm text-gray-600 dark:text-gray-400">Tax:</span>
                          <span className="text-sm text-gray-900 dark:text-white">
                            {formatCurrency(invoice.total_taxes_and_charges || invoice.taxAmount || 0, invoiceCurrency)}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between w-64 pt-2 border-t border-gray-200 dark:border-gray-600">
                        <span className="text-base font-semibold text-gray-900 dark:text-white">Grand Total:</span>
                        <span className="text-base font-bold text-gray-900 dark:text-white">
                          {formatCurrency(
                            invoice.base_grand_total || invoice.grand_total || invoice.totalAmount || 0,
                            invoiceCurrency
                          )}
                        </span>
                      </div>
                      {outstandingAmount > 0 && (
                        <div className="flex justify-between w-64">
                          <span className="text-sm text-gray-600 dark:text-gray-400">Outstanding:</span>
                          <span className="text-sm font-medium text-red-600 dark:text-red-400">
                            {formatCurrency(outstandingAmount, invoiceCurrency)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Payment Details */}
                  <div className="px-6 py-4 bg-yellow-50 dark:bg-yellow-900/20 border-t border-gray-200 dark:border-gray-600">
                    <div className="flex items-center space-x-2 mb-3">
                      <Package className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
                      <h4 className="text-sm font-semibold text-yellow-900 dark:text-yellow-100">Payment Details</h4>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-yellow-700 dark:text-yellow-300">Payment Method:</span>
                        <span className="ml-2 text-yellow-900 dark:text-yellow-100">
                          {invoice.mode_of_payment || invoice.paymentMethod || "-"}
                        </span>
                      </div>
                      <div>
                        <span className="text-yellow-700 dark:text-yellow-300">Paid Amount:</span>
                        <span className="ml-2 text-yellow-900 dark:text-yellow-100">
                          {formatCurrency(invoice.paid_amount || invoice.paidAmount || 0, invoiceCurrency)}
                        </span>
                      </div>
                      <div>
                        <span className="text-yellow-700 dark:text-yellow-300">Status:</span>
                        <span className="ml-2 text-yellow-900 dark:text-yellow-100">{invoice.status}</span>
                      </div>
                      <div>
                        <span className="text-yellow-700 dark:text-yellow-300">Outstanding:</span>
                        <span className="ml-2 text-yellow-900 dark:text-yellow-100">
                          {formatCurrency(outstandingAmount, invoiceCurrency)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Supplier Details - 30% */}
              <div className="lg:col-span-1">
                <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                  <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <Building2 className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Supplier Details</h3>
                      </div>
                    </div>
                  </div>
                  <div className="p-6">
                    <div className="space-y-4">
                      <div>
                        <h4 className="text-lg font-medium text-gray-900 dark:text-white">
                          {invoice.supplier_name || invoice.supplier}
                        </h4>
                      </div>

                      {invoice.supplier_address_doc?.email_id && (
                        <div className="flex items-center space-x-3">
                          <Mail className="w-4 h-4 text-gray-400" />
                          <span className="text-sm text-gray-600 dark:text-gray-400">
                            {invoice.supplier_address_doc.email_id}
                          </span>
                        </div>
                      )}

                      {invoice.supplier_address_doc?.phone && (
                        <div className="flex items-center space-x-3">
                          <Phone className="w-4 h-4 text-gray-400" />
                          <span className="text-sm text-gray-600 dark:text-gray-400">
                            {invoice.supplier_address_doc.phone}
                          </span>
                        </div>
                      )}

                      {invoice.supplier_address_doc?.address_line1 && (
                        <div className="flex items-start space-x-3">
                          <MapPin className="w-4 h-4 text-gray-400 mt-0.5" />
                          <div className="text-sm text-gray-600 dark:text-gray-400">
                            <p>{invoice.supplier_address_doc.address_line1}</p>
                            {invoice.supplier_address_doc.city && <p>{invoice.supplier_address_doc.city}</p>}
                            {invoice.supplier_address_doc.country && <p>{invoice.supplier_address_doc.country}</p>}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Make Payment Modal */}
        <MakePaymentModal
          isOpen={showMakePaymentModal}
          onClose={() => setShowMakePaymentModal(false)}
          invoiceName={invoice.name || invoice.id}
          outstandingAmount={outstandingAmount}
          currency={invoiceCurrency}
          onPaymentComplete={() => {
            window.location.reload();
          }}
        />

        {/* Delete Confirmation Dialog */}
        <ConfirmDialog
          isOpen={showDeleteConfirm}
          onClose={handleDeleteCancel}
          onConfirm={handleDeleteConfirm}
          title="Delete Draft Invoice"
          message={`Are you sure you want to delete draft invoice ${invoice.name || invoice.id}? This action cannot be undone.`}
          confirmText="Delete"
          cancelText="Cancel"
          confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        />
      </div>
    </div>
  );
}
