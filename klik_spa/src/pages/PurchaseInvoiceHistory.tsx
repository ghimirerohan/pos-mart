import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  FileText,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  FilePlus,
  RefreshCw,
  Download,
  Search,
  DollarSign,
  Grid3X3,
  List,
  Eye,
  RotateCcw,
  FileMinus,
} from "lucide-react";

import BottomNavigation from "../components/BottomNavigation";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { formatCurrency } from "../utils/currency";
import type { PurchaseInvoice } from "../../types";
import { usePurchaseInvoices } from "../hooks/usePurchaseInvoices";
import { useUserInfo } from "../hooks/useUserInfo";
import { usePOSDetails } from "../hooks/usePOSProfile";
import { toast } from "react-toastify";
import { returnPurchaseInvoice, deleteDraftPurchaseInvoice } from "../services/purchaseInvoice";
import { useAllPaymentModes } from "../hooks/usePaymentModes";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { isToday, isThisWeek, isThisMonth, isThisYear } from "../utils/time";

export default function PurchaseInvoiceHistoryPage() {
  const navigate = useNavigate();
  const isMobile = useMediaQuery("(max-width: 1024px)");
  const [activeTab, setActiveTab] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilter, setDateFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");
  const [viewMode, setViewMode] = useState<"cards" | "list">("list");

  // Delete confirmation states
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [invoiceToDelete, setInvoiceToDelete] = useState<PurchaseInvoice | null>(null);

  // Pass user filter to API so it filters on server side
  const { invoices, isLoading, isLoadingMore, error, hasMore, totalLoaded, totalCount, loadMore } = usePurchaseInvoices(searchTerm, userFilter);
  const { modes } = useAllPaymentModes();
  const { posDetails } = usePOSDetails();
  const { userInfo, isLoading: userInfoLoading } = useUserInfo();

  // Role-based filtering
  const isAdminUser = userInfo?.is_admin_user || false;
  const currentUserName = userInfo?.full_name || "";

  // Set default user filter for non-admin users
  useEffect(() => {
    if (!isAdminUser && currentUserName && userFilter === "all") {
      setUserFilter(currentUserName);
    }
  }, [isAdminUser, currentUserName, userFilter]);

  const tabs = [
    { id: "all", name: "All Invoices", icon: FileText, color: "text-gray-600" },
    { id: "Draft", name: "Draft", icon: FilePlus, color: "text-gray-500" },
    { id: "Unpaid", name: "Unpaid", icon: Clock, color: "text-yellow-600" },
    { id: "Partly Paid", name: "Partly Paid", icon: AlertTriangle, color: "text-orange-600" },
    { id: "Paid", name: "Paid", icon: CheckCircle, color: "text-green-600" },
    { id: "Overdue", name: "Overdue", icon: XCircle, color: "text-red-600" },
    { id: "Return", name: "Returns", icon: RefreshCw, color: "text-purple-600" },
    { id: "Cancelled", name: "Cancelled", icon: XCircle, color: "text-red-500" },
  ];

  const filterInvoiceByDate = (invoiceDateStr: string) => {
    if (dateFilter === "all") return true;

    if (dateFilter === "today") {
      return isToday(invoiceDateStr);
    }

    if (dateFilter === "yesterday") {
      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const invoiceDate = new Date(invoiceDateStr);
      return (
        invoiceDate.getUTCFullYear() === yesterday.getUTCFullYear() &&
        invoiceDate.getUTCMonth() === yesterday.getUTCMonth() &&
        invoiceDate.getUTCDate() === yesterday.getUTCDate()
      );
    }

    if (dateFilter === "week") {
      return isThisWeek(invoiceDateStr);
    }

    if (dateFilter === "month") {
      return isThisMonth(invoiceDateStr);
    }

    if (dateFilter === "year") {
      return isThisYear(invoiceDateStr);
    }

    return true;
  };


const getStatusBadge = (status: string) => {
  const baseClasses = "px-2 py-1 rounded-full text-xs font-medium";
  const normalized = status?.toLowerCase() || "";

  switch (normalized) {
    case "paid":
      return `${baseClasses} bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400`;
    case "unpaid":
      return `${baseClasses} bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400`;
    case "partly paid":
      return `${baseClasses} bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-400`;
    case "overdue":
      return `${baseClasses} bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400`;
    case "draft":
      return `${baseClasses} bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400`;
    case "return":
    case "debit note issued":
      return `${baseClasses} bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-400`;
    case "cancelled":
      return `${baseClasses} bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400`;
    default:
      return `${baseClasses} bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400`;
  }
};


  const filteredInvoices = useMemo(() => {
    if (isLoading) return [];
    if (error) return [];

    const filtered = invoices.filter((invoice) => {
      const invoiceStatus = (invoice.status || "").trim();
      const tabStatus = (activeTab || "").trim();
      const matchesStatus = activeTab === "all" || invoiceStatus === tabStatus;
      const matchesPayment = paymentFilter === "all" || invoice.paymentMethod === paymentFilter;
      const matchesUser = userFilter === "all" || invoice.user === userFilter;
      const matchesDate = filterInvoiceByDate(invoice.date);

      return matchesPayment && matchesUser && matchesStatus && matchesDate;
    });

    return filtered;
  }, [invoices, activeTab, dateFilter, paymentFilter, userFilter, isLoading, error]);

  const uniqueUsers = useMemo(() => {
    return [...new Set(invoices.map(invoice => invoice.user).filter(Boolean))];
  }, [invoices]);

  // Get count for each status
  const getStatusCount = (status: string) => {
    const invoicesFilteredByOtherFilters = invoices.filter((invoice) => {
      const matchesPayment = paymentFilter === "all" || invoice.paymentMethod === paymentFilter;
      const matchesUser = userFilter === "all" || invoice.user === userFilter;
      const matchesDate = filterInvoiceByDate(invoice.date);
      return matchesPayment && matchesUser && matchesDate;
    });

    if (status === "all") {
      return invoicesFilteredByOtherFilters.length;
    }
    const normalizedStatus = (status || "").trim();
    return invoicesFilteredByOtherFilters.filter(invoice => {
      const invoiceStatus = (invoice.status || "").trim();
      return invoiceStatus === normalizedStatus;
    }).length;
  };

  // Loading state
  if ((isLoading && invoices.length === 0) || userInfoLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-beveren-600 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-300">Loading purchase invoices...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="bg-red-50 dark:bg-red-900/20 p-6 rounded-lg max-w-md">
          <h3 className="text-lg font-medium text-red-800 dark:text-red-200">Error loading invoices</h3>
          <p className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p>
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

  const renderFilters = () => (
    <div className="w-full max-w-none bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 mb-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16} />
          <input
            type="text"
            placeholder="Search invoices..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-beveren-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
          {isLoading && invoices.length > 0 && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <div className="animate-spin h-4 w-4 border-2 border-b-transparent border-beveren-500 rounded-full"></div>
            </div>
          )}
        </div>
        <select
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-beveren-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
        >
          <option value="all">All Time</option>
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
          <option value="week">This Week</option>
          <option value="month">This Month</option>
          <option value="year">This Year</option>
        </select>
        <select
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value)}
          disabled={!isAdminUser}
          className={`px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-beveren-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white ${
            !isAdminUser ? 'opacity-50 cursor-not-allowed' : ''
          }`}
        >
          <option value="all">All Users</option>
          {uniqueUsers.map((user) => (
            <option key={user} value={user}>
              {user}
            </option>
          ))}
        </select>
        {!isAdminUser && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Showing only your transactions</p>
        )}
        <select
          value={paymentFilter}
          onChange={(e) => setPaymentFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-beveren-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
        >
          <option value="all">All Payments</option>
          {modes.map((mode) => (
            <option key={mode.name} value={mode.name}>
              {mode.name}
            </option>
          ))}
        </select>
      </div>
      {hasMore && (
        <div className="mt-3 text-center">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Search works on all invoices in the database. Load more invoices to see additional results.
          </p>
        </div>
      )}
    </div>
  );

  const renderSummaryCards = () => (
    <div className="w-full max-w-none grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400">Total Invoices</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{filteredInvoices.length}</p>
            {hasMore && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Showing {totalLoaded} of {totalCount}
              </p>
            )}
          </div>
          <FileText className="w-8 h-8 text-blue-600" />
        </div>
      </div>
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400">Total Amount</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">
              {formatCurrency(filteredInvoices.reduce((sum, inv) => sum + inv.totalAmount, 0), posDetails?.currency || 'USD')}
            </p>
          </div>
          <DollarSign className="w-8 h-8 text-blue-600" />
        </div>
      </div>
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400">Paid Amount</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">
              {formatCurrency(
                filteredInvoices
                  .filter(inv => inv.status === "Paid")
                  .reduce((sum, inv) => sum + inv.totalAmount, 0),
                posDetails?.currency || 'USD'
              )}
            </p>
          </div>
          <CheckCircle className="w-8 h-8 text-green-600" />
        </div>
      </div>
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400">Outstanding</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">
              {formatCurrency(
                filteredInvoices
                  .filter(inv => ["Unpaid", "Partly Paid", "Overdue"].includes(inv.status))
                  .reduce((sum, inv) => sum + (inv.outstandingAmount || inv.totalAmount), 0),
                posDetails?.currency || 'USD'
              )}
            </p>
          </div>
          <AlertTriangle className="w-8 h-8 text-orange-600" />
        </div>
      </div>
    </div>
  );

  const handleViewInvoice = (invoice: PurchaseInvoice) => {
    navigate(`/purchase-invoice/${invoice.id}`);
  };

  const hasReturnableItems = (invoice: PurchaseInvoice) => {
    if (!invoice || !invoice.items) {
      return false;
    }

    if (invoice.canReturn !== undefined) {
      return invoice.canReturn;
    }

    const hasReturnable = invoice.items.some(item => {
      const soldQty = item.qty || item.quantity || 0;
      const returnedQty = item.returned_qty || 0;
      return returnedQty < soldQty;
    });

    return hasReturnable;
  };

  const handleDeleteClick = (invoice: PurchaseInvoice) => {
    if (invoice.status !== "Draft") {
      toast.error("Only draft invoices can be deleted");
      return;
    }
    setInvoiceToDelete(invoice);
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = async () => {
    if (!invoiceToDelete) return;

    try {
      await deleteDraftPurchaseInvoice(invoiceToDelete.id);
      toast.success(`Draft invoice ${invoiceToDelete.id} deleted successfully`);
      setShowDeleteConfirm(false);
      setInvoiceToDelete(null);
      window.location.reload();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to delete invoice");
    }
  };

  const handleDeleteCancel = () => {
    setShowDeleteConfirm(false);
    setInvoiceToDelete(null);
  };

  const handleReturnClick = async (invoice: PurchaseInvoice) => {
    try {
      const result = await returnPurchaseInvoice(invoice.id);
      navigate(`/purchase-invoice/${result.return_invoice}`);
      toast.success(`Invoice returned: ${result.return_invoice}`);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to return invoice");
    }
  };

  const handleExportInvoices = () => {
    try {
      if (!filteredInvoices || filteredInvoices.length === 0) {
        toast.error("No invoices to export");
        return;
      }

      // Create CSV content
      const headers = ["Invoice", "Supplier", "Date", "Amount", "Outstanding", "Status", "Payment Method"];
      const rows = filteredInvoices.map(invoice => [
        invoice.id,
        invoice.supplier,
        invoice.date,
        invoice.totalAmount.toFixed(2),
        (invoice.outstandingAmount || 0).toFixed(2),
        invoice.status,
        invoice.paymentMethod
      ]);

      const csvContent = [headers, ...rows].map(row => row.join(",")).join("\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", `purchase_invoices_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast.success(`Exported ${filteredInvoices.length} invoices successfully`);
    } catch (error: unknown) {
      console.error('Export error:', error);
      toast.error(`Failed to export invoices: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const renderInvoicesTable = () => (
    <div className="w-full max-w-none bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          {activeTab === "all" ? "All Invoices" : tabs.find(t => t.id === activeTab)?.name} ({filteredInvoices.length})
        </h3>
        <div className="flex items-center space-x-2 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
          <button
            onClick={() => setViewMode("list")}
            className={`p-2 rounded-md transition-colors ${
              viewMode === "list"
                ? "bg-white dark:bg-gray-600 text-beveren-600 dark:text-beveren-400 shadow-sm"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            <List className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode("cards")}
            className={`p-2 rounded-md transition-colors ${
              viewMode === "cards"
                ? "bg-white dark:bg-gray-600 text-beveren-600 dark:text-beveren-400 shadow-sm"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            <Grid3X3 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {viewMode === "list" ? (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Invoice
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Supplier
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  User
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Payment
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Amount
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-600">
              {filteredInvoices.map((invoice) => (
                <tr key={`${activeTab}-${invoice.id}`} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <div className="text-sm font-medium text-gray-900 dark:text-white">{invoice.id}</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        {invoice.date} {invoice.time}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900 dark:text-white">{invoice.supplier}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                    {invoice.user}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="text-sm text-gray-900 dark:text-white">{invoice.paymentMethod}</span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900 dark:text-white">
                      {formatCurrency(invoice.totalAmount, invoice.currency)}
                    </div>
                    {invoice.outstandingAmount > 0 && (
                      <div className="text-xs text-red-600 dark:text-red-400">
                        Outstanding: {formatCurrency(invoice.outstandingAmount, invoice.currency)}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={getStatusBadge(invoice.status)}>{invoice.status}</span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <div className="flex space-x-2">
                      <button
                        onClick={() => handleViewInvoice(invoice)}
                        className="text-beveren-600 hover:text-beveren-900 flex items-center space-x-1"
                      >
                        <Eye className="w-4 h-4" />
                        <span>View</span>
                      </button>
                      {["Paid", "Unpaid", "Overdue", "Partly Paid", "Debit Note Issued"].includes(invoice.status) && !invoice.isReturn && hasReturnableItems(invoice) && (
                        <button
                          onClick={() => handleReturnClick(invoice)}
                          className="text-orange-600 hover:text-orange-900 flex items-center space-x-1"
                        >
                          <RotateCcw className="w-4 h-4" />
                          <span>Return</span>
                        </button>
                      )}
                      {invoice.status === "Draft" && (
                        <button
                          onClick={() => handleDeleteClick(invoice)}
                          className="text-red-600 hover:text-red-900 flex items-center space-x-1"
                        >
                          <FileMinus className="w-4 h-4" />
                          <span>Delete</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6">
          {filteredInvoices.map((invoice) => (
            <div
              key={`${activeTab}-${invoice.id}`}
              className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 border border-gray-200 dark:border-gray-600 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-medium text-gray-900 dark:text-white">{invoice.id}</div>
                <span className={getStatusBadge(invoice.status)}>{invoice.status}</span>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">Supplier:</span>
                  <span className="text-gray-900 dark:text-white">{invoice.supplier}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">Amount:</span>
                  <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(invoice.totalAmount, invoice.currency)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">Date:</span>
                  <span className="text-gray-900 dark:text-white">{invoice.date}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">User:</span>
                  <span className="text-gray-900 dark:text-white">{invoice.user}</span>
                </div>
              </div>
              <div className="mt-4 flex space-x-2">
                <button
                  onClick={() => handleViewInvoice(invoice)}
                  className="flex-1 text-xs px-3 py-2 bg-beveren-600 text-white rounded hover:bg-beveren-700 transition-colors"
                >
                  View
                </button>
                {["Paid", "Unpaid", "Overdue", "Partly Paid", "Debit Note Issued"].includes(invoice.status) && hasReturnableItems(invoice) && (
                  <button
                    onClick={() => handleReturnClick(invoice)}
                    className="flex-1 text-xs px-3 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 transition-colors"
                  >
                    Return
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Load More Button */}
      {hasMore && (
        <div className="flex justify-center mt-8 pb-8">
          <button
            onClick={loadMore}
            disabled={isLoadingMore}
            className={`px-6 py-3 rounded-lg font-medium transition-colors ${
              isLoadingMore
                ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
                : 'bg-beveren-600 text-white hover:bg-beveren-700'
            }`}
          >
            {isLoadingMore ? (
              <div className="flex items-center space-x-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                <span>Loading...</span>
              </div>
            ) : (
              `Load More (${totalLoaded}/${totalCount})`
            )}
          </button>
        </div>
      )}

      {/* Show message when all invoices are loaded */}
      {!hasMore && totalLoaded > 0 && (
        <div className="text-center mt-8 py-4">
          <p className="text-gray-600 dark:text-gray-400">
            {filteredInvoices.length > 0
              ? `Showing ${filteredInvoices.length} invoice${filteredInvoices.length !== 1 ? 's' : ''} (${totalLoaded} total loaded)`
              : `All ${totalCount} invoices loaded`
            }
          </p>
        </div>
      )}
    </div>
  );

  // Mobile layout
  if (isMobile) {
    return (
      <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-gray-900 font-inconsolata">
        {/* Mobile Header */}
        <div className="sticky top-0 z-20 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
          <div className="px-4 py-3">
            <div className="flex items-center justify-between">
              <h1 className="text-lg font-bold text-gray-900 dark:text-white">Purchase History</h1>
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleExportInvoices}
                  className="flex items-center space-x-2 px-3 py-2 bg-beveren-600 text-white rounded-lg hover:bg-beveren-700 transition-colors text-sm"
                >
                  <Download className="w-4 h-4" />
                  <span>Export</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto pb-20 w-[98%] mx-auto px-2 py-4">
          {/* Status Tabs */}
          <div className="mb-6 w-full">
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <div className="border-b border-gray-200 dark:border-gray-700">
                <nav className="-mb-px flex space-x-4 overflow-x-auto">
                  {tabs.map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex items-center space-x-2 py-2 px-1 border-b-2 font-medium text-xs whitespace-nowrap ${
                        activeTab === tab.id
                          ? "border-beveren-500 text-beveren-600 dark:text-beveren-400"
                          : `border-transparent ${tab.color} dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300`
                      }`}
                    >
                      <tab.icon className="w-4 h-4" />
                      <span>{tab.name}</span>
                      <span className="ml-1 px-1.5 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 rounded-full">
                        {getStatusCount(tab.id)}
                      </span>
                    </button>
                  ))}
                </nav>
              </div>
            </div>
          </div>

          {renderFilters()}
          {renderSummaryCards()}
          {renderInvoicesTable()}
        </div>

        {/* Delete Confirmation Dialog */}
        <ConfirmDialog
          isOpen={showDeleteConfirm}
          onClose={handleDeleteCancel}
          onConfirm={handleDeleteConfirm}
          title="Delete Draft Invoice"
          message={`Are you sure you want to delete draft invoice ${invoiceToDelete?.id}? This action cannot be undone.`}
          confirmText="Delete"
          cancelText="Cancel"
          confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        />

        {/* Bottom Navigation */}
        <BottomNavigation />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex pb-12">
      <div className="flex-1 flex flex-col overflow-hidden ml-20">
        {/* Header */}
        <div className="fixed top-0 left-20 right-0 z-50 bg-beveren-50 dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
          <div className="px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Purchase Invoice History</h1>
              </div>
              <div className="flex items-center space-x-3">
                <button
                  onClick={handleExportInvoices}
                  className="flex items-center space-x-2 px-4 py-2 bg-beveren-600 text-white rounded-lg hover:bg-beveren-700 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  <span>Export</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 px-6 py-8 mt-16 max-w-none">
          {/* Status Tabs */}
          <div className="mb-8 w-full max-w-none">
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
              <div className="border-b border-gray-200 dark:border-gray-700">
                <nav className="-mb-px flex space-x-8 overflow-x-auto">
                  {tabs.map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex items-center space-x-2 py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
                        activeTab === tab.id
                          ? "border-beveren-500 text-beveren-600 dark:text-beveren-400"
                          : `border-transparent ${tab.color} dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300`
                      }`}
                    >
                      <tab.icon className="w-5 h-5" />
                      <span>{tab.name}</span>
                      <span className="ml-2 px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 rounded-full">
                        {getStatusCount(tab.id)}
                      </span>
                    </button>
                  ))}
                </nav>
              </div>
            </div>
          </div>

          {/* Filters */}
          {renderFilters()}

          {/* Summary Cards */}
          {renderSummaryCards()}

          {/* Invoices Table/Grid */}
          {renderInvoicesTable()}
        </div>

        {/* Delete Confirmation Dialog */}
        <ConfirmDialog
          isOpen={showDeleteConfirm}
          onClose={handleDeleteCancel}
          onConfirm={handleDeleteConfirm}
          title="Delete Draft Invoice"
          message={`Are you sure you want to delete draft invoice ${invoiceToDelete?.id}? This action cannot be undone.`}
          confirmText="Delete"
          cancelText="Cancel"
          confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        />
      </div>
    </div>
  );
}
