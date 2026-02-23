import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  MonitorX,
  X,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Wallet,
  CreditCard,
} from "lucide-react";

import BottomNavigation from "../components/BottomNavigation";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { usePOSDetails } from "../hooks/usePOSProfile";
import { useCreatePOSClosingEntry } from "../services/closingEntry";
import {
  usePaymentTransactions,
  calculateTotalIn,
  calculateTotalOut,
  calculateTotalNet,
  calculateTotalOpening,
} from "../hooks/usePaymentTransactions";
import type { PaymentModeSummary } from "../hooks/usePaymentTransactions";
import {
  PaymentModeCard,
  TransactionList,
  InvoiceSummary,
  CashierFilter,
} from "../components/closing";
import { formatCurrency } from "../utils/currency";
import { clearAllCache } from "../utils/clearCache";

export default function ClosingShiftPage() {
  const navigate = useNavigate();
  const isMobile = useMediaQuery("(max-width: 1024px)");
  const [selectedCashier, setSelectedCashier] = useState<string | undefined>(
    undefined
  );
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closingAmounts, setClosingAmounts] = useState<Record<string, number>>(
    {}
  );
  const [selectedPaymentMode, setSelectedPaymentMode] = useState<string | null>(
    null
  );

  const { createClosingEntry, isCreating } = useCreatePOSClosingEntry();
  const { posDetails } = usePOSDetails();

  const {
    paymentSummary,
    transactions,
    invoiceSummary,
    cashiers,
    isAdmin,
    isLoading,
    error,
    totalCreditGiven,
    refetch,
  } = usePaymentTransactions(selectedCashier);

  const hideExpectedAmount = posDetails?.custom_hide_expected_amount || false;
  const currency = posDetails?.currency || "USD";

  // Separate real payment modes from credit
  const realPaymentModes = useMemo(() => {
    return Object.values(paymentSummary).filter(
      (m) => m.type === "payment_mode"
    );
  }, [paymentSummary]);

  const paymentModeNames = useMemo(() => {
    return realPaymentModes.map((m) => m.name);
  }, [realPaymentModes]);

  const grandTotals = useMemo(() => {
    return {
      opening: calculateTotalOpening(paymentSummary),
      in: calculateTotalIn(paymentSummary),
      out: calculateTotalOut(paymentSummary),
      net: calculateTotalNet(paymentSummary),
    };
  }, [paymentSummary]);

  const handleCashierChange = (cashierId: string) => {
    setSelectedCashier(cashierId);
    refetch(cashierId);
  };

  const handleClosingAmountChange = (modeName: string, value: string) => {
    setClosingAmounts((prev) => ({
      ...prev,
      [modeName]: parseFloat(value) || 0,
    }));
  };

  const handleViewInvoice = (invoiceId: string) => {
    navigate(`/invoice/${invoiceId}`);
  };

  const handleFinalClose = async () => {
    try {
      const closingBalanceArray = realPaymentModes.map((mode) => ({
        mode_of_payment: mode.name,
        closing_amount: closingAmounts[mode.name] || 0,
      }));

      await createClosingEntry(closingBalanceArray, totalCreditGiven);
      setShowCloseModal(false);

      clearAllCache();

      try {
        await fetch("/api/method/klik_pos.api.cache.clear_backend_cache", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          credentials: "include",
        });
      } catch (e) {
        console.warn("Failed to clear backend cache after close:", e);
      }

      navigate("/pos");
    } catch (err) {
      console.error("Error closing shift:", err);
    }
  };

  const getPaymentIcon = (modeName: string) => {
    const statName = (modeName || "").toLowerCase();
    if (statName.includes("cash")) return "💵";
    if (
      statName.includes("qr") ||
      statName.includes("fonepay") ||
      statName.includes("esewa") ||
      statName.includes("khalti")
    )
      return "📱";
    if (statName.includes("credit") || statName.includes("card")) return "💳";
    return "💰";
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-beveren-600 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-300">
            Loading payment transactions...
          </p>
        </div>
      </div>
    );
  }

  if (error && !error.includes("No open POS Opening Entry found")) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="bg-red-50 dark:bg-red-900/20 p-6 rounded-lg max-w-md">
          <h3 className="text-lg font-medium text-red-800 dark:text-red-200">
            Error loading data
          </h3>
          <p className="mt-2 text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 rounded hover:bg-red-200 dark:hover:bg-red-800"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const hasNoOpeningEntry =
    error && error.includes("No open POS Opening Entry found");

  const renderCreditCard = () => {
    if (totalCreditGiven <= 0) return null;
    const creditSummary = paymentSummary["Credit"] as
      | PaymentModeSummary
      | undefined;
    const txnCount = creditSummary?.transactions || 0;

    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border-2 border-orange-200 dark:border-orange-800 p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center space-x-2">
            <CreditCard className="w-5 h-5 text-orange-500" />
            <h3 className="font-semibold text-gray-900 dark:text-white">
              Credit Given
            </h3>
          </div>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {txnCount} invoice{txnCount !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">
          {formatCurrency(totalCreditGiven, currency)}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Total outstanding from unpaid/partially paid sales
        </p>
      </div>
    );
  };

  const renderContent = () => (
    <div className="space-y-6">
      {hasNoOpeningEntry && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
          <div className="flex items-center">
            <div className="text-yellow-600 dark:text-yellow-400 mr-3">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                No Opening Entry Found
              </h3>
              <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                You can still close the shift, but payment summary will not be
                available.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Grand Totals Summary Bar */}
      {!hideExpectedAmount && !hasNoOpeningEntry && (
        <div className="bg-gradient-to-r from-beveren-600 to-beveren-700 rounded-xl p-4 text-white">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="flex items-center justify-center space-x-1 mb-1">
                <Wallet className="w-4 h-4 opacity-75" />
                <span className="text-sm opacity-75">Opening</span>
              </div>
              <div className="text-xl font-bold">
                {formatCurrency(grandTotals.opening, currency)}
              </div>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center space-x-1 mb-1">
                <TrendingUp className="w-4 h-4 text-green-300" />
                <span className="text-sm opacity-75">Total In</span>
              </div>
              <div className="text-xl font-bold text-green-300">
                +{formatCurrency(grandTotals.in, currency)}
              </div>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center space-x-1 mb-1">
                <TrendingDown className="w-4 h-4 text-red-300" />
                <span className="text-sm opacity-75">Total Out</span>
              </div>
              <div className="text-xl font-bold text-red-300">
                -{formatCurrency(grandTotals.out, currency)}
              </div>
            </div>
            <div className="text-center">
              <div className="text-sm opacity-75 mb-1">Expected Cash</div>
              <div className="text-2xl font-bold">
                {formatCurrency(grandTotals.net, currency)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Payment Mode Cards + Credit Card */}
      {!hideExpectedAmount && !hasNoOpeningEntry && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Payment Breakdown
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {realPaymentModes.map((mode) => (
              <PaymentModeCard
                key={mode.name}
                mode={mode}
                currency={currency}
                onClick={() =>
                  setSelectedPaymentMode(
                    selectedPaymentMode === mode.name ? null : mode.name
                  )
                }
                isSelected={selectedPaymentMode === mode.name}
              />
            ))}
            {renderCreditCard()}
          </div>
        </div>
      )}

      {/* Transaction List */}
      <TransactionList
        transactions={transactions}
        currency={currency}
        paymentModes={paymentModeNames}
        onViewInvoice={handleViewInvoice}
      />

      {/* Invoice Summary */}
      {invoiceSummary && (
        <InvoiceSummary summary={invoiceSummary} currency={currency} />
      )}
    </div>
  );

  const renderCloseModal = () => (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            Close Shift
          </h2>
          <button
            onClick={() => setShowCloseModal(false)}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Cash and QR input fields */}
          {realPaymentModes.map((stat) => (
            <div
              key={stat.name}
              className="flex items-center justify-between gap-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg"
            >
              <div className="flex items-center space-x-3 flex-shrink-0">
                <div className="text-xl">{getPaymentIcon(stat.name)}</div>
                <div>
                  <span className="font-medium text-gray-900 dark:text-white">
                    {stat.name}
                  </span>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    Expected: {formatCurrency(stat.net, currency)}
                  </div>
                </div>
              </div>

              <div className="flex flex-col space-y-2">
                <div className="text-sm">
                  <span className="text-gray-600 dark:text-gray-400">
                    Opening:{" "}
                  </span>
                  <span className="font-medium text-gray-900 dark:text-white">
                    {formatCurrency(stat.opening, currency)}
                  </span>
                </div>

                <div className="flex-shrink-0">
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Actual amount"
                    value={closingAmounts[stat.name] || ""}
                    onChange={(e) =>
                      handleClosingAmountChange(stat.name, e.target.value)
                    }
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-beveren-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                  />
                </div>

                {closingAmounts[stat.name] !== undefined &&
                  closingAmounts[stat.name] !== null && (
                    <div
                      className={`text-xs font-medium ${
                        closingAmounts[stat.name] - stat.net >= 0
                          ? "text-green-600 dark:text-green-400"
                          : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      Diff:{" "}
                      {closingAmounts[stat.name] - stat.net >= 0 ? "+" : ""}
                      {formatCurrency(
                        closingAmounts[stat.name] - stat.net,
                        currency
                      )}
                    </div>
                  )}
              </div>
            </div>
          ))}

          {/* Credit - static display, no input */}
          {totalCreditGiven > 0 && (
            <div className="flex items-center justify-between gap-4 p-4 bg-orange-50 dark:bg-orange-900/20 rounded-lg border border-orange-200 dark:border-orange-800">
              <div className="flex items-center space-x-3">
                <CreditCard className="w-5 h-5 text-orange-500" />
                <div>
                  <span className="font-medium text-gray-900 dark:text-white">
                    Credit Given
                  </span>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    Outstanding from this session
                  </div>
                </div>
              </div>
              <div className="text-xl font-bold text-orange-600 dark:text-orange-400">
                {formatCurrency(totalCreditGiven, currency)}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end space-x-3 mt-6 pt-4 border-t border-gray-200 dark:border-gray-600">
          <button
            onClick={() => setShowCloseModal(false)}
            className="px-4 py-2 text-red-600 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-500 font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleFinalClose}
            disabled={isCreating}
            className={`px-6 py-2 rounded-lg font-medium transition-colors ${
              isCreating
                ? "bg-gray-400 text-gray-200 cursor-not-allowed"
                : "bg-beveren-600 text-white hover:bg-beveren-700"
            }`}
          >
            {isCreating ? "Closing..." : "Close Shift"}
          </button>
        </div>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="sticky top-0 z-20 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
          <div className="pl-14 pr-4 py-3">
            <div className="flex items-center justify-between">
              <h1 className="text-lg font-bold text-gray-900 dark:text-white">
                Closing Shift
              </h1>
              <div className="flex items-center space-x-2">
                <CashierFilter
                  cashiers={cashiers}
                  selectedCashier={selectedCashier}
                  onCashierChange={handleCashierChange}
                  isAdmin={isAdmin}
                />
                <button
                  onClick={() => setShowCloseModal(true)}
                  className="flex items-center space-x-2 px-3 py-2 bg-beveren-600 text-white rounded-lg hover:bg-beveren-700 transition-colors text-sm"
                >
                  <MonitorX className="w-4 h-4" />
                  <span>Close</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pb-4 w-[98%] mx-auto px-2 py-4">
          {renderContent()}
        </div>

        {showCloseModal && renderCloseModal()}

        <BottomNavigation />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex pb-12">
      <div className="flex-1 flex flex-col overflow-hidden ml-20">
        <div className="fixed top-0 left-20 right-0 z-50 bg-beveren-50 dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
          <div className="px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                  Closing Shift
                </h1>
                <CashierFilter
                  cashiers={cashiers}
                  selectedCashier={selectedCashier}
                  onCashierChange={handleCashierChange}
                  isAdmin={isAdmin}
                />
              </div>
              <button
                onClick={() => setShowCloseModal(true)}
                className="flex items-center space-x-2 px-4 py-2 bg-beveren-600 text-white rounded-lg hover:bg-beveren-700 transition-colors"
              >
                <MonitorX className="w-4 h-4" />
                <span>Close</span>
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 px-6 py-8 mt-16 overflow-y-auto">
          {renderContent()}
        </div>

        {showCloseModal && renderCloseModal()}
      </div>
    </div>
  );
}
