import { useState } from "react";
import { ChevronDown, ChevronUp, TrendingUp, TrendingDown } from "lucide-react";
import type { PaymentModeSummary } from "../../hooks/usePaymentTransactions";
import { formatCurrency } from "../../utils/currency";

interface PaymentModeCardProps {
  mode: PaymentModeSummary;
  currency: string;
  onClick?: () => void;
  isSelected?: boolean;
}

export default function PaymentModeCard({
  mode,
  currency,
  onClick,
  isSelected = false,
}: PaymentModeCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

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
          <button
            onClick={handleExpandClick}
            className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            {isExpanded ? (
              <ChevronUp className="w-5 h-5 text-gray-500" />
            ) : (
              <ChevronDown className="w-5 h-5 text-gray-500" />
            )}
          </button>
        </div>

        {/* Opening Balance */}
        {mode.opening > 0 && (
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
            <span className="text-gray-900 dark:text-white font-bold">NET</span>
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

      {/* Expanded Details */}
      {isExpanded && (
        <div className="px-4 pb-4 pt-2 border-t border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50 rounded-b-xl">
          {/* IN Breakdown */}
          {hasInTransactions && (
            <div className="mb-3">
              <div className="text-xs font-medium text-green-600 dark:text-green-400 mb-1 uppercase tracking-wide">
                Money In
              </div>
              <div className="space-y-1 text-sm">
                {mode.in.sales > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Sales</span>
                    <span className="text-gray-900 dark:text-white">
                      +{formatCurrency(mode.in.sales, currency)}
                    </span>
                  </div>
                )}
                {mode.in.partial_payments > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Partial Payments</span>
                    <span className="text-gray-900 dark:text-white">
                      +{formatCurrency(mode.in.partial_payments, currency)}
                    </span>
                  </div>
                )}
                {mode.in.credit_payments > 0 && (
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

          {/* OUT Breakdown */}
          {hasOutTransactions && (
            <div>
              <div className="text-xs font-medium text-red-600 dark:text-red-400 mb-1 uppercase tracking-wide">
                Money Out
              </div>
              <div className="space-y-1 text-sm">
                {mode.out.returns > 0 && (
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

          {/* No transactions message */}
          {!hasInTransactions && !hasOutTransactions && (
            <div className="text-sm text-gray-500 dark:text-gray-400 text-center py-2">
              No transactions
            </div>
          )}
        </div>
      )}
    </div>
  );
}
