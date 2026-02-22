import { useState, useMemo } from "react";
import { Search, TrendingUp, TrendingDown, Eye, FileText, CreditCard } from "lucide-react";
import type {
  PaymentTransaction,
  TransactionSource,
  TransactionType,
} from "../../hooks/usePaymentTransactions";
import {
  filterTransactionsByType,
  filterTransactionsBySource,
  filterTransactionsByPaymentMode,
  getSourceLabel,
  getSourceColor,
} from "../../hooks/usePaymentTransactions";
import { formatCurrency } from "../../utils/currency";

type FilterTab = "all" | TransactionType | TransactionSource;

interface TransactionListProps {
  transactions: PaymentTransaction[];
  currency: string;
  paymentModes: string[];
  onViewInvoice?: (reference: string) => void;
}

export default function TransactionList({
  transactions,
  currency,
  paymentModes,
  onViewInvoice,
}: TransactionListProps) {
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [paymentModeFilter, setPaymentModeFilter] = useState("all");

  // Filter tabs configuration
  const filterTabs: { id: FilterTab; label: string; color: string }[] = [
    { id: "all", label: "All", color: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200" },
    { id: "in", label: "Money In", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
    { id: "sales", label: "Sales", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
    { id: "partial_payment", label: "Partial Payments", color: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400" },
    { id: "credit_payment", label: "Credit Payments", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400" },
    { id: "out", label: "Money Out", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
    { id: "return", label: "Returns", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
    { id: "credit_given", label: "Credits Given", color: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400" },
  ];

  // Apply filters
  const filteredTransactions = useMemo(() => {
    let result = [...transactions];

    // Apply tab filter
    if (activeTab === "in") {
      result = filterTransactionsByType(result, "in");
    } else if (activeTab === "out") {
      result = filterTransactionsByType(result, "out");
    } else if (activeTab !== "all") {
      result = filterTransactionsBySource(result, activeTab as TransactionSource);
    }

    // Apply payment mode filter
    if (paymentModeFilter !== "all") {
      result = filterTransactionsByPaymentMode(result, paymentModeFilter);
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (t) =>
          (t.reference || "").toLowerCase().includes(query) ||
          (t.customer || "").toLowerCase().includes(query) ||
          (t.cashier || "").toLowerCase().includes(query) ||
          (t.payment_mode || "").toLowerCase().includes(query)
      );
    }

    return result;
  }, [transactions, activeTab, paymentModeFilter, searchQuery]);

  // Calculate totals for filtered transactions
  const totals = useMemo(() => {
    const inAmount = filteredTransactions
      .filter((t) => t.type === "in")
      .reduce((sum, t) => sum + t.amount, 0);
    const outAmount = filteredTransactions
      .filter((t) => t.type === "out")
      .reduce((sum, t) => sum + t.amount, 0);
    return { in: inAmount, out: outAmount, net: inAmount - outAmount };
  }, [filteredTransactions]);

  const formatTime = (timeStr: string) => {
    if (!timeStr) return "";
    // Handle timedelta format (HH:MM:SS)
    const parts = timeStr.split(":");
    if (parts.length >= 2) {
      const hour = parseInt(parts[0], 10);
      const minute = parts[1];
      const ampm = hour >= 12 ? "PM" : "AM";
      const displayHour = hour % 12 || 12;
      return `${displayHour}:${minute} ${ampm}`;
    }
    return timeStr;
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Transactions ({filteredTransactions.length})
          </h3>

          {/* Summary Bar */}
          <div className="flex items-center space-x-4 text-sm">
            <div className="flex items-center space-x-1">
              <TrendingUp className="w-4 h-4 text-green-500" />
              <span className="text-green-600 dark:text-green-400 font-medium">
                +{formatCurrency(totals.in, currency)}
              </span>
            </div>
            <div className="flex items-center space-x-1">
              <TrendingDown className="w-4 h-4 text-red-500" />
              <span className="text-red-600 dark:text-red-400 font-medium">
                -{formatCurrency(totals.out, currency)}
              </span>
            </div>
            <div className="font-bold text-gray-900 dark:text-white">
              = {formatCurrency(totals.net, currency)}
            </div>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex flex-wrap gap-2 mt-4">
          {filterTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                activeTab === tab.id
                  ? `${tab.color} ring-2 ring-offset-1 ring-beveren-500`
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search and Payment Mode Filter */}
        <div className="flex flex-col sm:flex-row gap-3 mt-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search by reference, customer, or cashier..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-beveren-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
            />
          </div>
          <select
            value={paymentModeFilter}
            onChange={(e) => setPaymentModeFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-beveren-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
          >
            <option value="all">All Payment Modes</option>
            {paymentModes.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Transaction List */}
      <div className="overflow-x-auto">
        {filteredTransactions.length === 0 ? (
          <div className="py-12 text-center text-gray-500 dark:text-gray-400">
            <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No transactions found</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Reference
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Customer
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Payment
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Amount
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Time
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Cashier
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {filteredTransactions.map((txn) => (
                <tr
                  key={txn.id}
                  className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                >
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center space-x-2">
                      {txn.reference_type === "Payment Entry" ? (
                        <CreditCard className="w-4 h-4 text-blue-500" />
                      ) : (
                        <FileText className="w-4 h-4 text-gray-400" />
                      )}
                      <div>
                        <div className="text-sm font-medium text-gray-900 dark:text-white">
                          {txn.reference}
                        </div>
                        {txn.linked_invoice && (
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            for {txn.linked_invoice}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="text-sm text-gray-900 dark:text-white">{txn.customer}</div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getSourceColor(txn.source)}`}>
                      {getSourceLabel(txn.source)}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="text-sm text-gray-900 dark:text-white">{txn.payment_mode}</span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span
                      className={`text-sm font-semibold ${
                        txn.type === "in"
                          ? "text-green-600 dark:text-green-400"
                          : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {txn.type === "in" ? "+" : "-"}
                      {formatCurrency(txn.amount, currency)}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      {formatTime(txn.posting_time)}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="text-sm text-gray-600 dark:text-gray-300">{txn.cashier}</div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {txn.reference_type === "Sales Invoice" && onViewInvoice && (
                      <button
                        onClick={() => onViewInvoice(txn.reference)}
                        className="flex items-center space-x-1 text-beveren-600 hover:text-beveren-800 dark:text-beveren-400 dark:hover:text-beveren-300 text-sm"
                      >
                        <Eye className="w-4 h-4" />
                        <span>View</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
