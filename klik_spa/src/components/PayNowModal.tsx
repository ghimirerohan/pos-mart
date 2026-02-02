import { useState, useEffect, useCallback } from "react";
import { X, CreditCard, Banknote, Loader2, CheckCircle, AlertCircle, RefreshCw, AlertTriangle } from "lucide-react";
import { toast } from "react-toastify";
import { usePaymentModes } from "../hooks/usePaymentModes";
import { usePOSDetails } from "../hooks/usePOSProfile";
import { payUnpaidInvoice, getInvoicePaymentStatus, updateInvoiceOutstanding } from "../services/salesInvoice";
import { formatCurrency } from "../utils/currency";

interface PayNowModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoiceName: string;
  outstandingAmount: number;
  currency: string;
  onPaymentComplete: () => void;
}

export default function PayNowModal({
  isOpen,
  onClose,
  invoiceName,
  outstandingAmount: initialOutstandingAmount,
  currency,
  onPaymentComplete,
}: PayNowModalProps) {
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [isLoadingInvoice, setIsLoadingInvoice] = useState(false);
  const [currentOutstandingAmount, setCurrentOutstandingAmount] = useState(initialOutstandingAmount);
  const [glOutstandingAmount, setGlOutstandingAmount] = useState<number | null>(null);
  const [invoiceStatus, setInvoiceStatus] = useState<string>("");
  const [isAlreadyPaid, setIsAlreadyPaid] = useState(false);
  const [hasDiscrepancy, setHasDiscrepancy] = useState(false);
  const [isFixingDiscrepancy, setIsFixingDiscrepancy] = useState(false);

  const { posDetails } = usePOSDetails();
  const { modes, isLoading: modesLoading } = usePaymentModes(
    typeof posDetails?.name === "string" ? posDetails.name : ""
  );

  // Fetch fresh invoice payment status when modal opens
  const fetchLatestInvoiceData = useCallback(async () => {
    if (!invoiceName) return;
    
    setIsLoadingInvoice(true);
    try {
      // Use the new payment status API that checks GL entries
      const result = await getInvoicePaymentStatus(invoiceName);
      if (result.success && result.data) {
        const data = result.data;
        const fieldOutstanding = data.outstanding_amount_field || 0;
        const glOutstanding = data.gl_outstanding;
        const status = data.invoice_status || "";
        
        setCurrentOutstandingAmount(fieldOutstanding);
        setGlOutstandingAmount(glOutstanding);
        setInvoiceStatus(status);
        setHasDiscrepancy(data.has_discrepancy || false);
        
        // Check if invoice is actually paid (GL outstanding is 0 or negative)
        if (glOutstanding !== null && glOutstanding <= 0) {
          setIsAlreadyPaid(true);
          // If there's a discrepancy (field shows outstanding but GL shows paid),
          // we'll offer to fix it
        } else if (fieldOutstanding <= 0) {
          setIsAlreadyPaid(true);
        } else {
          setIsAlreadyPaid(false);
        }
      }
    } catch (error) {
      console.error("Error fetching invoice payment status:", error);
      // Fall back to the passed outstanding amount
      setCurrentOutstandingAmount(initialOutstandingAmount);
      setGlOutstandingAmount(null);
    } finally {
      setIsLoadingInvoice(false);
    }
  }, [invoiceName, initialOutstandingAmount]);

  // Fix the discrepancy by updating the invoice outstanding amount
  const handleFixDiscrepancy = async () => {
    setIsFixingDiscrepancy(true);
    try {
      const result = await updateInvoiceOutstanding(invoiceName);
      if (result.success) {
        toast.success("Invoice outstanding updated successfully");
        // Refresh the data
        await fetchLatestInvoiceData();
        // Trigger page refresh after a short delay
        setTimeout(() => {
          onPaymentComplete();
          onClose();
        }, 1500);
      } else {
        toast.error(result.error || "Failed to update invoice");
      }
    } catch (error) {
      console.error("Error fixing discrepancy:", error);
      toast.error("Failed to update invoice outstanding");
    } finally {
      setIsFixingDiscrepancy(false);
    }
  };

  // Reset state and fetch fresh data when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedPaymentMethod("");
      setIsProcessing(false);
      setIsComplete(false);
      setIsAlreadyPaid(false);
      setCurrentOutstandingAmount(initialOutstandingAmount);
      // Fetch the latest invoice data
      fetchLatestInvoiceData();
    }
  }, [isOpen, initialOutstandingAmount, fetchLatestInvoiceData]);

  // Set default payment method when modes load
  useEffect(() => {
    if (modes.length > 0 && !selectedPaymentMethod) {
      const defaultMode = modes.find((m) => m.default === 1);
      if (defaultMode) {
        setSelectedPaymentMethod(defaultMode.mode_of_payment);
      } else {
        setSelectedPaymentMethod(modes[0].mode_of_payment);
      }
    }
  }, [modes, selectedPaymentMethod]);

  const handlePayment = async () => {
    if (!selectedPaymentMethod) {
      toast.error("Please select a payment method");
      return;
    }

    if (currentOutstandingAmount <= 0) {
      toast.error("This invoice has no outstanding amount");
      return;
    }

    setIsProcessing(true);

    try {
      const result = await payUnpaidInvoice(
        invoiceName,
        selectedPaymentMethod,
        currentOutstandingAmount
      );

      if (result.success) {
        setIsComplete(true);
        toast.success(`Payment of ${formatCurrency(currentOutstandingAmount, currency)} received successfully!`);
        
        // Wait a moment to show success state, then close
        setTimeout(() => {
          onPaymentComplete();
          onClose();
        }, 1500);
      } else {
        // Check if the error indicates the invoice is already paid
        const errorMsg = result.error || "Failed to process payment";
        if (errorMsg.toLowerCase().includes("no outstanding") || 
            errorMsg.toLowerCase().includes("already") ||
            errorMsg.toLowerCase().includes("fully paid")) {
          setIsAlreadyPaid(true);
          setCurrentOutstandingAmount(0);
          toast.info("This invoice has already been paid. Refreshing...");
          // Refresh the page after a short delay
          setTimeout(() => {
            onPaymentComplete();
            onClose();
          }, 2000);
        } else {
          toast.error(errorMsg);
        }
      }
    } catch (error) {
      console.error("Payment error:", error);
      const errorMsg = error instanceof Error ? error.message : "Failed to process payment";
      
      // Check if the error indicates the invoice is already paid
      if (errorMsg.toLowerCase().includes("no outstanding") || 
          errorMsg.toLowerCase().includes("already") ||
          errorMsg.toLowerCase().includes("fully paid")) {
        setIsAlreadyPaid(true);
        setCurrentOutstandingAmount(0);
        toast.info("This invoice has already been paid. Refreshing...");
        // Refresh the page after a short delay
        setTimeout(() => {
          onPaymentComplete();
          onClose();
        }, 2000);
      } else {
        toast.error(errorMsg);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRefreshAndClose = () => {
    onPaymentComplete();
    onClose();
  };

  if (!isOpen) return null;

  const getPaymentMethodIcon = (methodName: string) => {
    const lowerName = methodName.toLowerCase();
    if (lowerName.includes("cash")) {
      return <Banknote size={20} />;
    }
    return <CreditCard size={20} />;
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Receive Payment
          </h2>
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {isLoadingInvoice ? (
            // Loading state while fetching latest invoice data
            <div className="text-center py-8">
              <Loader2 className="w-10 h-10 animate-spin text-beveren-600 mx-auto mb-4" />
              <p className="text-gray-600 dark:text-gray-400">
                Checking invoice status...
              </p>
            </div>
          ) : isComplete ? (
            // Success state
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-10 h-10 text-green-600 dark:text-green-400" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                Payment Received!
              </h3>
              <p className="text-gray-600 dark:text-gray-400">
                Invoice {invoiceName} has been paid
              </p>
            </div>
          ) : isAlreadyPaid ? (
            // Already paid state
            <div className="text-center py-6">
              <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-10 h-10 text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                Invoice Already Paid
              </h3>
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                This invoice has been fully paid according to the accounting records.
              </p>
              
              {/* Show discrepancy warning if status doesn't match */}
              {hasDiscrepancy && invoiceStatus && !["Paid", "Return"].includes(invoiceStatus) && (
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg p-4 mb-4 text-left">
                  <div className="flex items-start space-x-3">
                    <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                        Status Mismatch Detected
                      </p>
                      <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                        The invoice shows as "{invoiceStatus}" but accounting records show it's fully paid.
                      </p>
                      <div className="mt-2 text-xs text-yellow-600 dark:text-yellow-400 space-y-1">
                        <p>• Displayed Outstanding: {formatCurrency(currentOutstandingAmount, currency)}</p>
                        <p>• Actual (GL) Outstanding: {formatCurrency(glOutstandingAmount || 0, currency)}</p>
                      </div>
                      <button
                        onClick={handleFixDiscrepancy}
                        disabled={isFixingDiscrepancy}
                        className="mt-3 px-4 py-2 bg-yellow-600 text-white text-sm rounded-lg hover:bg-yellow-700 transition-colors disabled:opacity-50 flex items-center space-x-2"
                      >
                        {isFixingDiscrepancy ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Fixing...</span>
                          </>
                        ) : (
                          <>
                            <RefreshCw className="w-4 h-4" />
                            <span>Fix Status</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}
              
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Click "Refresh & Close" to update the page.
              </p>
            </div>
          ) : (
            <>
              {/* Invoice Info */}
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Invoice</span>
                  <span className="font-medium text-gray-900 dark:text-white">{invoiceName}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Outstanding Amount</span>
                  <span className="text-xl font-bold text-red-600 dark:text-red-400">
                    {formatCurrency(currentOutstandingAmount, currency)}
                  </span>
                </div>
                {invoiceStatus && (
                  <div className="flex justify-between items-center mt-2">
                    <span className="text-sm text-gray-600 dark:text-gray-400">Status</span>
                    <span className="text-sm font-medium text-gray-900 dark:text-white">{invoiceStatus}</span>
                  </div>
                )}
              </div>

              {/* Payment Methods */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                  Select Payment Method
                </label>
                
                {modesLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-beveren-600" />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {modes.map((mode) => (
                      <button
                        key={mode.mode_of_payment}
                        onClick={() => setSelectedPaymentMethod(mode.mode_of_payment)}
                        disabled={isProcessing}
                        className={`flex items-center space-x-3 p-4 rounded-lg border-2 transition-all ${
                          selectedPaymentMethod === mode.mode_of_payment
                            ? "border-beveren-500 bg-beveren-50 dark:bg-beveren-900/20"
                            : "border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500"
                        } ${isProcessing ? "opacity-50 cursor-not-allowed" : ""}`}
                      >
                        <div className={`p-2 rounded-lg ${
                          selectedPaymentMethod === mode.mode_of_payment
                            ? "bg-beveren-100 text-beveren-600 dark:bg-beveren-800 dark:text-beveren-400"
                            : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
                        }`}>
                          {getPaymentMethodIcon(mode.mode_of_payment)}
                        </div>
                        <span className={`font-medium text-sm ${
                          selectedPaymentMethod === mode.mode_of_payment
                            ? "text-beveren-700 dark:text-beveren-300"
                            : "text-gray-700 dark:text-gray-300"
                        }`}>
                          {mode.mode_of_payment}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!isComplete && !isLoadingInvoice && (
          <div className="px-6 py-4 bg-gray-50 dark:bg-gray-700/50 border-t border-gray-200 dark:border-gray-700">
            {isAlreadyPaid ? (
              // Already paid - show refresh button
              <button
                onClick={handleRefreshAndClose}
                className="w-full px-4 py-3 bg-beveren-600 text-white rounded-lg hover:bg-beveren-700 transition-colors font-medium flex items-center justify-center space-x-2"
              >
                <RefreshCw size={20} />
                <span>Refresh & Close</span>
              </button>
            ) : (
              // Normal payment buttons
              <div className="flex space-x-3">
                <button
                  onClick={onClose}
                  disabled={isProcessing}
                  className="flex-1 px-4 py-3 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handlePayment}
                  disabled={isProcessing || !selectedPaymentMethod || modesLoading || currentOutstandingAmount <= 0}
                  className="flex-1 px-4 py-3 bg-beveren-600 text-white rounded-lg hover:bg-beveren-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>Processing...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle size={20} />
                      <span>Receive {formatCurrency(currentOutstandingAmount, currency)}</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
