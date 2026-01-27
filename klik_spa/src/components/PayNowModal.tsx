import { useState, useEffect } from "react";
import { X, CreditCard, Banknote, Loader2, CheckCircle } from "lucide-react";
import { toast } from "react-toastify";
import { usePaymentModes } from "../hooks/usePaymentModes";
import { usePOSDetails } from "../hooks/usePOSProfile";
import { payUnpaidInvoice } from "../services/salesInvoice";
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
  outstandingAmount,
  currency,
  onPaymentComplete,
}: PayNowModalProps) {
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isComplete, setIsComplete] = useState(false);

  const { posDetails } = usePOSDetails();
  const { modes, isLoading: modesLoading } = usePaymentModes(
    typeof posDetails?.name === "string" ? posDetails.name : ""
  );

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedPaymentMethod("");
      setIsProcessing(false);
      setIsComplete(false);
    }
  }, [isOpen]);

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

    setIsProcessing(true);

    try {
      const result = await payUnpaidInvoice(
        invoiceName,
        selectedPaymentMethod,
        outstandingAmount
      );

      if (result.success) {
        setIsComplete(true);
        toast.success(`Payment of ${formatCurrency(outstandingAmount, currency)} received successfully!`);
        
        // Wait a moment to show success state, then close
        setTimeout(() => {
          onPaymentComplete();
          onClose();
        }, 1500);
      } else {
        toast.error(result.error || "Failed to process payment");
      }
    } catch (error) {
      console.error("Payment error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to process payment");
    } finally {
      setIsProcessing(false);
    }
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
          {isComplete ? (
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
                    {formatCurrency(outstandingAmount, currency)}
                  </span>
                </div>
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
        {!isComplete && (
          <div className="px-6 py-4 bg-gray-50 dark:bg-gray-700/50 border-t border-gray-200 dark:border-gray-700">
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
                disabled={isProcessing || !selectedPaymentMethod || modesLoading}
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
                    <span>Receive {formatCurrency(outstandingAmount, currency)}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
