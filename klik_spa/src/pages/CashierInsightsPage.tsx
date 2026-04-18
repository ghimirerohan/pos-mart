import { useMemo, useState, useEffect, useCallback } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { TrendingUp, TrendingDown, CreditCard, Banknote } from "lucide-react";
import { NepaliDatePicker } from "nepali-datepicker-reactjs";
import "nepali-datepicker-reactjs/dist/index.css";

import BottomNavigation from "../components/BottomNavigation";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { usePOSDetails } from "../hooks/usePOSProfile";
import { useUserInfo } from "../hooks/useUserInfo";
import {
  calculateTotalIn,
  calculateTotalOut,
  calculateTotalNet,
} from "../hooks/usePaymentTransactions";
import type { PaymentModeSummary, PaymentTransaction } from "../hooks/usePaymentTransactions";
import { usePaymentTransactionsReport } from "../hooks/usePaymentTransactionsReport";
import {
  PaymentModeCard,
  TransactionList,
  InvoiceSummary,
  CashierFilter,
} from "../components/closing";
import { formatCurrency } from "../utils/currency";
import {
  BS_YEAR_END,
  BS_YEAR_START,
  bsDateToStr,
  fetchAdToBsMap,
  fetchBsDefaults,
  fetchBsRangeToAd,
  formatNepaliTime,
  parseBsDateStr,
  type BSDate,
} from "../utils/nepaliBsDate";

const pickerInputClass =
  "w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-2 text-sm";

export default function CashierInsightsPage() {
  const navigate = useNavigate();
  const { userInfo, isLoading: userInfoLoading } = useUserInfo();
  const isMobile = useMediaQuery("(max-width: 1024px)");

  const [defaultsLoading, setDefaultsLoading] = useState(true);
  const [fromBs, setFromBs] = useState<BSDate>({ year: 2081, month: 1, day: 1 });
  const [toBs, setToBs] = useState<BSDate>({ year: 2081, month: 1, day: 1 });
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selectedCashier, setSelectedCashier] = useState<string>("all");
  const [selectedPaymentMode, setSelectedPaymentMode] = useState<string | null>(null);
  const [adToBsMap, setAdToBsMap] = useState<Record<string, string>>({});

  const cashierParam = selectedCashier;

  const allowReport =
    !userInfoLoading &&
    userInfo?.is_administrator === true &&
    !defaultsLoading &&
    !!fromDate &&
    !!toDate;

  const {
    paymentSummary,
    transactions,
    invoiceSummary,
    cashiers,
    isLoading: reportLoading,
    error,
    totalCreditGiven,
    refetch,
  } = usePaymentTransactionsReport(
    allowReport ? fromDate : "",
    allowReport ? toDate : "",
    cashierParam
  );

  const { posDetails } = usePOSDetails();
  const hideExpectedAmount = posDetails?.custom_hide_expected_amount || false;
  const currency = posDetails?.currency || "USD";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await fetchBsDefaults();
        if (!cancelled) {
          setFromBs(d.fromBs);
          setToBs(d.toBs);
          setFromDate(d.fromDateAd);
          setToDate(d.toDateAd);
        }
      } finally {
        if (!cancelled) setDefaultsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (defaultsLoading) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const r = await fetchBsRangeToAd(fromBs, toBs);
        if (!cancelled) {
          setFromDate(r.from_date_ad);
          setToDate(r.to_date_ad);
        }
      } catch (e) {
        console.error("BS range to AD failed:", e);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fromBs, toBs, defaultsLoading]);

  useEffect(() => {
    if (transactions.length === 0) {
      setAdToBsMap({});
      return;
    }
    let cancelled = false;
    const dates = transactions.map((t) => t.posting_date).filter(Boolean);
    fetchAdToBsMap(dates).then((map) => {
      if (!cancelled) setAdToBsMap(map);
    });
    return () => {
      cancelled = true;
    };
  }, [transactions]);

  const formatTxnBsDateTime = useCallback(
    (txn: PaymentTransaction) => {
      const ad = (txn.posting_date || "").slice(0, 10);
      const bs = adToBsMap[ad] || ad;
      const clock = formatNepaliTime(txn.posting_time || "");
      return `${bs} · ${clock}`;
    },
    [adToBsMap]
  );

  const periodBsLabel = useMemo(
    () => `${bsDateToStr(fromBs)} → ${bsDateToStr(toBs)}`,
    [fromBs, toBs]
  );

  const realPaymentModes = useMemo(() => {
    return Object.values(paymentSummary).filter((m) => m.type === "payment_mode");
  }, [paymentSummary]);

  const paymentModeNames = useMemo(() => {
    return realPaymentModes.map((m) => m.name);
  }, [realPaymentModes]);

  const grandTotals = useMemo(() => {
    const totalIn = calculateTotalIn(paymentSummary);
    const totalOut = calculateTotalOut(paymentSummary);
    const netFromApi = calculateTotalNet(paymentSummary);
    return {
      in: totalIn,
      out: totalOut,
      net: netFromApi,
    };
  }, [paymentSummary]);

  const handleCashierChange = (cashierId: string) => {
    setSelectedCashier(cashierId);
  };

  const handleViewInvoice = (invoiceId: string) => {
    navigate(`/invoice/${invoiceId}`);
  };

  if (!userInfoLoading && !userInfo?.is_administrator) {
    return <Navigate to="/pos" replace />;
  }

  if (userInfoLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600" />
      </div>
    );
  }

  if (defaultsLoading || !fromDate || !toDate) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600 mx-auto" />
          <p className="mt-4 text-gray-600 dark:text-gray-300">Loading date defaults…</p>
        </div>
        {isMobile && <BottomNavigation />}
      </div>
    );
  }

  if (reportLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600 mx-auto" />
          <p className="mt-4 text-gray-600 dark:text-gray-300">Loading cashier report…</p>
        </div>
        {isMobile && <BottomNavigation />}
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4">
        <div className="bg-red-50 dark:bg-red-900/20 p-6 rounded-lg max-w-md">
          <h3 className="text-lg font-medium text-red-800 dark:text-red-200">Unable to load report</h3>
          <p className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-4 px-4 py-2 bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 rounded hover:bg-red-200 dark:hover:bg-red-800"
          >
            Retry
          </button>
        </div>
        {isMobile && <BottomNavigation />}
      </div>
    );
  }

  const renderCreditCard = () => {
    if (totalCreditGiven <= 0) return null;
    const creditSummary = paymentSummary["Credit"] as PaymentModeSummary | undefined;
    const txnCount = creditSummary?.transactions || 0;

    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border-2 border-orange-200 dark:border-orange-800 p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center space-x-2">
            <CreditCard className="w-5 h-5 text-orange-500" />
            <h3 className="font-semibold text-gray-900 dark:text-white">Credit Given</h3>
          </div>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {txnCount} invoice{txnCount !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">
          {formatCurrency(totalCreditGiven, currency)}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Outstanding from unpaid or partly paid sales in this period
        </p>
      </div>
    );
  };

  const renderContent = () => (
    <div className="space-y-6">
      <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-3 py-2 text-sm font-semibold text-blue-900 dark:text-blue-100">
        {periodBsLabel}
      </div>

      {!hideExpectedAmount && (
        <div className="bg-gradient-to-r from-brand-600 to-brand-700 rounded-xl p-4 text-white">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
            <div>
              <div className="flex items-center justify-center space-x-1 mb-1">
                <TrendingUp className="w-4 h-4 text-green-300" />
                <span className="text-sm opacity-90">Total In</span>
              </div>
              <div className="text-xl font-bold text-green-300">
                +{formatCurrency(grandTotals.in, currency)}
              </div>
            </div>
            <div>
              <div className="flex items-center justify-center space-x-1 mb-1">
                <TrendingDown className="w-4 h-4 text-red-300" />
                <span className="text-sm opacity-90">Total Out</span>
              </div>
              <div className="text-xl font-bold text-red-300">
                −{formatCurrency(grandTotals.out, currency)}
              </div>
            </div>
            <div>
              <div className="flex items-center justify-center space-x-1 mb-1">
                <Banknote className="w-4 h-4 opacity-90" />
                <span className="text-sm opacity-90">Net (period)</span>
              </div>
              <div className="text-2xl font-bold">{formatCurrency(grandTotals.net, currency)}</div>
            </div>
          </div>
          {invoiceSummary != null && (invoiceSummary.total_bill_discount ?? 0) > 0 && (
            <div className="mt-3 pt-3 border-t border-white/25 text-center text-sm">
              <span className="opacity-90">Discounts on sales (report scope): </span>
              <span className="font-bold text-amber-200">
                {formatCurrency(invoiceSummary.total_bill_discount ?? 0, currency)}
              </span>
            </div>
          )}
        </div>
      )}

      {!hideExpectedAmount && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Payment Breakdown</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {realPaymentModes.map((mode) => (
              <PaymentModeCard
                key={mode.name}
                mode={mode}
                currency={currency}
                onClick={() =>
                  setSelectedPaymentMode(selectedPaymentMode === mode.name ? null : mode.name)
                }
                isSelected={selectedPaymentMode === mode.name}
                showOpening={false}
                netLabel="Net (period)"
                alwaysShowBreakdown
              />
            ))}
            {renderCreditCard()}
          </div>
        </div>
      )}

      <TransactionList
        transactions={transactions}
        currency={currency}
        paymentModes={paymentModeNames}
        onViewInvoice={handleViewInvoice}
        formatTransactionDateTime={formatTxnBsDateTime}
      />

      {invoiceSummary && <InvoiceSummary summary={invoiceSummary} currency={currency} />}
    </div>
  );

  const dateFilterRow = (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col space-y-1 min-w-[160px]">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">From (BS)</span>
        <div className="nepali-date-picker-wrapper">
          <NepaliDatePicker
            value={bsDateToStr(fromBs)}
            onChange={(value) => {
              const parsed = parseBsDateStr(value);
              if (parsed) setFromBs(parsed);
            }}
            options={{ calenderLocale: "ne", valueLocale: "en", closeOnSelect: true }}
            minYear={BS_YEAR_START}
            maxYear={BS_YEAR_END}
            className="w-full"
            inputClassName={pickerInputClass}
          />
        </div>
      </div>
      <div className="flex flex-col space-y-1 min-w-[160px]">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">To (BS)</span>
        <div className="nepali-date-picker-wrapper">
          <NepaliDatePicker
            value={bsDateToStr(toBs)}
            onChange={(value) => {
              const parsed = parseBsDateStr(value);
              if (parsed) setToBs(parsed);
            }}
            options={{ calenderLocale: "ne", valueLocale: "en", closeOnSelect: true }}
            minYear={BS_YEAR_START}
            maxYear={BS_YEAR_END}
            className="w-full"
            inputClassName={pickerInputClass}
          />
        </div>
      </div>
      <CashierFilter
        cashiers={cashiers}
        selectedCashier={selectedCashier}
        onCashierChange={handleCashierChange}
        isAdmin
      />
    </div>
  );

  if (isMobile) {
    return (
      <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="sticky top-0 z-20 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
          <div className="pl-14 pr-4 py-3 space-y-3">
            <h1 className="text-lg font-bold text-gray-900 dark:text-white">Cashier insights</h1>
            {dateFilterRow}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pb-4 w-[98%] mx-auto px-2 py-4">{renderContent()}</div>

        <BottomNavigation />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex pb-12">
      <div className="flex-1 flex flex-col overflow-hidden ml-20">
        <div className="fixed top-0 left-20 right-0 z-50 bg-brand-50 dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
          <div className="px-4 py-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white shrink-0">Cashier insights</h1>
              {dateFilterRow}
            </div>
          </div>
        </div>

        <div className="flex-1 px-6 py-8 mt-24 lg:mt-28 overflow-y-auto">{renderContent()}</div>
      </div>
    </div>
  );
}
