import { useState } from "react";
import { ChevronDown, ChevronUp, FileText, CheckCircle, Clock, RotateCcw } from "lucide-react";
import type { InvoiceSummary as InvoiceSummaryType } from "../../hooks/usePaymentTransactions";
import { formatCurrency } from "../../utils/currency";

interface InvoiceSummaryProps {
  summary: InvoiceSummaryType;
  currency: string;
}

export default function InvoiceSummary({ summary, currency }: InvoiceSummaryProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
      {/* Collapsible Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors rounded-xl"
      >
        <div className="flex items-center space-x-3">
          <FileText className="w-5 h-5 text-gray-500" />
          <span className="font-medium text-gray-900 dark:text-white">
            Invoice Summary ({summary.total_invoices} invoices)
          </span>
        </div>

        {/* Quick Stats (always visible) */}
        <div className="flex items-center space-x-4">
          <div className="hidden sm:flex items-center space-x-4 text-sm">
            <span className="flex items-center space-x-1 text-green-600 dark:text-green-400">
              <CheckCircle className="w-4 h-4" />
              <span>{summary.paid}</span>
            </span>
            <span className="flex items-center space-x-1 text-orange-600 dark:text-orange-400">
              <Clock className="w-4 h-4" />
              <span>{summary.unpaid}</span>
            </span>
            <span className="flex items-center space-x-1 text-red-600 dark:text-red-400">
              <RotateCcw className="w-4 h-4" />
              <span>{summary.returns}</span>
            </span>
            <span className="font-semibold text-gray-900 dark:text-white">
              {formatCurrency(summary.net_sales, currency)}
            </span>
          </div>
          {isExpanded ? (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
        </div>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="px-4 pb-4 border-t border-gray-200 dark:border-gray-700">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4">
            {/* Total Invoices */}
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
              <div className="flex items-center space-x-2 mb-1">
                <FileText className="w-4 h-4 text-gray-500" />
                <span className="text-xs text-gray-500 dark:text-gray-400 uppercase font-medium">
                  Total
                </span>
              </div>
              <div className="text-xl font-bold text-gray-900 dark:text-white">
                {summary.total_invoices}
              </div>
            </div>

            {/* Paid */}
            <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
              <div className="flex items-center space-x-2 mb-1">
                <CheckCircle className="w-4 h-4 text-green-500" />
                <span className="text-xs text-green-600 dark:text-green-400 uppercase font-medium">
                  Paid
                </span>
              </div>
              <div className="text-xl font-bold text-green-600 dark:text-green-400">
                {summary.paid}
              </div>
            </div>

            {/* Unpaid */}
            <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-3">
              <div className="flex items-center space-x-2 mb-1">
                <Clock className="w-4 h-4 text-orange-500" />
                <span className="text-xs text-orange-600 dark:text-orange-400 uppercase font-medium">
                  Unpaid
                </span>
              </div>
              <div className="text-xl font-bold text-orange-600 dark:text-orange-400">
                {summary.unpaid}
              </div>
            </div>

            {/* Returns */}
            <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
              <div className="flex items-center space-x-2 mb-1">
                <RotateCcw className="w-4 h-4 text-red-500" />
                <span className="text-xs text-red-600 dark:text-red-400 uppercase font-medium">
                  Returns
                </span>
              </div>
              <div className="text-xl font-bold text-red-600 dark:text-red-400">
                {summary.returns}
              </div>
            </div>
          </div>

          {/* Financial Summary */}
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-600">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="flex justify-between sm:flex-col">
                <span className="text-sm text-gray-500 dark:text-gray-400">Total Sales</span>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {formatCurrency(summary.total_sales, currency)}
                </span>
              </div>
              <div className="flex justify-between sm:flex-col">
                <span className="text-sm text-gray-500 dark:text-gray-400">Total Returns</span>
                <span className="font-semibold text-red-600 dark:text-red-400">
                  -{formatCurrency(summary.total_returns, currency)}
                </span>
              </div>
              <div className="flex justify-between sm:flex-col">
                <span className="text-sm text-gray-500 dark:text-gray-400">Net Sales</span>
                <span className="font-bold text-lg text-gray-900 dark:text-white">
                  {formatCurrency(summary.net_sales, currency)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
