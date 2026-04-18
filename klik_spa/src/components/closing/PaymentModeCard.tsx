import { useState } from "react";
import { ChevronDown, ChevronUp, TrendingUp, TrendingDown } from "lucide-react";
import type { PaymentModeSummary } from "../../hooks/usePaymentTransactions";
import { formatCurrency } from "../../utils/currency";

interface PaymentModeCardProps {
  mode: PaymentModeSummary;
  currency: string;
  onClick?: () => void;
  isSelected?: boolean;
  /** When false, never show the opening row (e.g. period reports where opening is not meaningful). */
  showOpening?: boolean;
  /** Label for the net line (default: NET). */
  netLabel?: string;
  /** When true, Money In / Money Out lines are always visible (no expand/collapse). */
  alwaysShowBreakdown?: boolean;
}

export default function PaymentModeCard({
  mode,
  currency,
  onClick,
  isSelected = false,
  showOpening = true,
  netLabel = "NET",
  alwaysShowBreakdown = false,
}: PaymentModeCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const breakdownOpen = alwaysShowBreakdown || isExpanded;

  // Get icon based on payment mode name
  const getPaymentIcon = () => {
    const modeLower = (mode.name || "").toLowerCase();
    if (modeLower.includes("cash")) return "💵";
    if (
      modeLower.includes("qr") ||
      modeLower.includes("fonepay") ||
      modeLower.includes("esewa") ||
      modeLower.includes("khalti")
    )
      return "📱";
    if (modeLower.includes("credit") || modeLower.includes("card")) return "💳";
    if (modeLower.includes("bank") || modeLower.includes("transfer")) return "🏦";
    return "💰";
  };

  const handleExpandClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  const hasInTransactions = mode.in.total > 0;
  const hasOutTransactions = mode.out.total > 0;
  const showSalesRow = alwaysShowBreakdown || mode.in.sales > 0;
  const showPartialRow = alwaysShowBreakdown || mode.in.partial_payments > 0;
  const showCreditPaidRow = alwaysShowBreakdown || mode.in.credit_payments > 0;
  const showReturnsRow = alwaysShowBreakdown || mode.out.returns > 0;
  const showMoneyInSection = alwaysShowBreakdown || hasInTransactions;
  const showMoneyOutSection = alwaysShowBreakdown || hasOutTransactions;

  return (
    <div
      className={`bg-white dark:bg-gray-800 rounded-xl border-2 transition-all duration-200 cursor-pointer hover:shadow-lg ${
        isSelected
          ? "border-brand-500 shadow-md"
          : "border-gray-200 dark:border-gray-700"
      }`}
      onClick={onClick}
    >
      {/* Header */}
      <div className="p-4 pb-2">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <span className="text-2xl">{getPaymentIcon()}</span>
            <h3 className="font-semibold text-gray-900 dark:text-white">{mode.name}</h3>
          </div>
          {!alwaysShowBreakdown && (
            <button
              type="button"
              onClick={handleExpandClick}
              className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              aria-expanded={isExpanded}
            >
              {isExpanded ? (
                <ChevronUp className="w-5 h-5 text-gray-500" />
              ) : (
                <ChevronDown className="w-5 h-5 text-gray-500" />
              )}
            </button>
          )}
        </div>

        {/* Opening Balance (hidden when not meaningful, e.g. multi-day admin report) */}
        {showOpening && mode.opening > 0 && (
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-gray-500 dark:text-gray-400">Opening</span>
            <span className="font-medium text-gray-700 dark:text-gray-300">
              {formatCurrency(mode.opening, currency)}
            </span>
          </div>
        )}

        {/* IN Summary */}
        <div className="flex items-center justify-between text-sm mb-1">
          <div className="flex items-center space-x-1">
            <TrendingUp className="w-4 h-4 text-green-500" />
            <span className="text-green-600 dark:text-green-400 font-medium">IN</span>
          </div>
          <span className="font-semibold text-green-600 dark:text-green-400">
            +{formatCurrency(mode.in.total, currency)}
          </span>
        </div>

        {/* OUT Summary */}
        <div className="flex items-center justify-between text-sm mb-3">
          <div className="flex items-center space-x-1">
            <TrendingDown className="w-4 h-4 text-red-500" />
            <span className="text-red-600 dark:text-red-400 font-medium">OUT</span>
          </div>
          <span className="font-semibold text-red-600 dark:text-red-400">
            -{formatCurrency(mode.out.total, currency)}
          </span>
        </div>

        {/* NET - Highlighted */}
        <div className="pt-2 border-t border-gray-200 dark:border-gray-600">
          <div className="flex items-center justify-between">
            <span className="text-gray-900 dark:text-white font-bold">{netLabel}</span>
            <span
              className={`text-xl font-bold ${
                mode.net >= 0
                  ? "text-green-600 dark:text-green-400"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              {formatCurrency(mode.net, currency)}
            </span>
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 text-right mt-1">
            {mode.transactions} transaction{mode.transactions !== 1 ? "s" : ""}
          </div>
        </div>
      </div>

      {/* Breakdown (collapsible, or always visible when alwaysShowBreakdown) */}
      {breakdownOpen && (
        <div className="px-4 pb-4 pt-2 border-t border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 rounded-b-xl">
          {showMoneyInSection && (
            <div className="mb-3">
              <div className="text-xs font-medium text-green-600 dark:text-green-400 mb-1 uppercase tracking-wide">
                Money In
              </div>
              <div className="space-y-1 text-sm">
                {showSalesRow && (
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Sales</span>
                    <span className="text-gray-900 dark:text-white">
                      +{formatCurrency(mode.in.sales, currency)}
                    </span>
                  </div>
                )}
                {showPartialRow && (
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Partial Payments</span>
                    <span className="text-gray-900 dark:text-white">
                      +{formatCurrency(mode.in.partial_payments, currency)}
                    </span>
                  </div>
                )}
                {showCreditPaidRow && (
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Credits Paid</span>
                    <span className="text-gray-900 dark:text-white">
                      +{formatCurrency(mode.in.credit_payments, currency)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {showMoneyOutSection && (
            <div>
              <div className="text-xs font-medium text-red-600 dark:text-red-400 mb-1 uppercase tracking-wide">
                Money Out
              </div>
              <div className="space-y-1 text-sm">
                {showReturnsRow && (
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Returns</span>
                    <span className="text-gray-900 dark:text-white">
                      -{formatCurrency(mode.out.returns, currency)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {!alwaysShowBreakdown &&
            !showMoneyInSection &&
            !showMoneyOutSection && (
              <div className="text-sm text-gray-500 dark:text-gray-400 text-center py-2">
                No transactions
              </div>
            )}
        </div>
      )}
    </div>
  );
}
