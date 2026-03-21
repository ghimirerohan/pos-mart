"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Loader2, CheckCircle } from "lucide-react";
import { toast } from "react-toastify";
import { formatCurrency } from "../utils/currency";

const API_PREPARE = "/api/method/klik_pos.api.receive_outstanding.receive_outstanding_prepare";
const API_SUBMIT = "/api/method/klik_pos.api.receive_outstanding.receive_outstanding_submit";

interface PaymentMode {
  mode_of_payment: string;
  account?: string;
  default?: number;
}

interface ReceiveOutstandingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  customer: string;
  customerName: string;
  company: string;
  outstanding: number;
  currency: string;
}

export default function ReceiveOutstandingModal({
  isOpen,
  onClose,
  onSuccess,
  customer,
  customerName,
  company,
  outstanding,
  currency,
}: ReceiveOutstandingModalProps) {
  const [step, setStep] = useState<"amount" | "confirm">("amount");
  const [amount, setAmount] = useState("");
  const [paymentModes, setPaymentModes] = useState<PaymentMode[]>([]);
  const [loadingPrepare, setLoadingPrepare] = useState(false);
  const [loadingSubmit, setLoadingSubmit] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [totalOutstanding, setTotalOutstanding] = useState(outstanding);

  const [rows, setRows] = useState<{ mode_of_payment: string; amount: string }[]>([{ mode_of_payment: "", amount: "" }]);

  const fetchPrepare = useCallback(async () => {
    if (!customer || !company) return;
    setLoadingPrepare(true);
    setPrepareError(null);
    try {
      const params = new URLSearchParams({ customer, company });
      const res = await fetch(`${API_PREPARE}?${params}`, { credentials: "include" });
      const data = await res.json();
      const msg = data.message;
      if (msg?.success) {
        setTotalOutstanding(Number(msg.total_outstanding) || 0);
        const modes = (msg.payment_modes || []) as PaymentMode[];
        setPaymentModes(modes);
        if (modes.length > 0) {
          const defaultMode = modes.find((m) => m.default) || modes[0];
          setRows([{ mode_of_payment: defaultMode.mode_of_payment, amount: "" }]);
        }
      } else {
        setPrepareError(msg?.error || "Failed to load payment options");
      }
    } catch (e) {
      setPrepareError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoadingPrepare(false);
    }
  }, [customer, company]);

  useEffect(() => {
    if (isOpen && customer && company) {
      setStep("amount");
      setAmount("");
      setRows([{ mode_of_payment: "", amount: "" }]);
      setTotalOutstanding(outstanding);
      fetchPrepare();
    }
  }, [isOpen, customer, company, outstanding, fetchPrepare]);

  const amountNum = parseFloat(amount) || 0;
  const rowAmounts = rows.map((r) => parseFloat(r.amount) || 0);
  const sumRows = rowAmounts.reduce((a, b) => a + b, 0);
  const isValidAmount = amountNum > 0 && amountNum <= totalOutstanding;
  const isValidDistribution = Math.abs(sumRows - amountNum) < 0.01 && rows.every((r) => (parseFloat(r.amount) || 0) > 0 && r.mode_of_payment);

  const handleAddRow = () => {
    setRows((prev) => [...prev, { mode_of_payment: "", amount: "" }]);
  };

  const handleRowChange = (index: number, field: "mode_of_payment" | "amount", value: string) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  };

  const handleRemoveRow = (index: number) => {
    if (rows.length <= 1) return;
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDistributeAll = () => {
    if (!amountNum || amountNum <= 0 || paymentModes.length === 0) return;
    const perMode = amountNum / paymentModes.length;
    setRows(
      paymentModes.map((m) => ({
        mode_of_payment: m.mode_of_payment,
        amount: perMode.toFixed(2),
      }))
    );
  };

  const goToConfirm = () => {
    if (!isValidAmount || !isValidDistribution) return;
    setStep("confirm");
  };

  const handleSubmit = async () => {
    if (!isValidAmount || !isValidDistribution) return;
    setLoadingSubmit(true);
    try {
      const payments = rows
        .filter((r) => r.mode_of_payment && (parseFloat(r.amount) || 0) > 0)
        .map((r) => ({ mode_of_payment: r.mode_of_payment, amount: parseFloat(r.amount) || 0 }));
      const csrfToken = window.csrf_token;
      const res = await fetch(API_SUBMIT, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Frappe-CSRF-Token": csrfToken,
        },
        credentials: "include",
        body: new URLSearchParams({
          customer,
          company,
          payments: JSON.stringify(payments),
        }),
      });
      const data = await res.json();
      const msg = data.message;
      if (msg?.success) {
        toast.success(`Received ${formatCurrency(amountNum, currency)}. ${(msg.payment_entries || []).length} payment(s) created.`);
        onSuccess();
        onClose();
      } else {
        toast.error(msg?.error || "Payment failed");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Payment failed");
    } finally {
      setLoadingSubmit(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Receive Outstanding</h2>
          <button type="button" onClick={onClose} className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Customer: <span className="font-medium text-gray-900 dark:text-white">{customerName}</span>
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Outstanding: <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(totalOutstanding, currency)}</span>
          </p>

          {loadingPrepare && (
            <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Loading payment options...</span>
            </div>
          )}
          {prepareError && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm">
              {prepareError}
            </div>
          )}

          {!loadingPrepare && paymentModes.length > 0 && (
            <>
              {step === "amount" && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Amount to receive</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      max={totalOutstanding}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-2"
                    />
                    {amountNum > totalOutstanding && (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">Amount cannot exceed outstanding.</p>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Payment method(s)</label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleDistributeAll}
                          className="text-xs text-brand-600 hover:underline"
                        >
                          Split equally
                        </button>
                        <button type="button" onClick={handleAddRow} className="text-xs text-brand-600 hover:underline">
                          Add row
                        </button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {rows.map((row, index) => (
                        <div key={index} className="flex gap-2 items-center">
                          <select
                            value={row.mode_of_payment}
                            onChange={(e) => handleRowChange(index, "mode_of_payment", e.target.value)}
                            className="flex-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-2 text-sm"
                          >
                            <option value="">Select mode</option>
                            {paymentModes.map((m) => (
                              <option key={m.mode_of_payment} value={m.mode_of_payment}>
                                {m.mode_of_payment}
                              </option>
                            ))}
                          </select>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={row.amount}
                            onChange={(e) => handleRowChange(index, "amount", e.target.value)}
                            placeholder="0"
                            className="w-28 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white px-3 py-2 text-sm"
                          />
                          {rows.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveRow(index)}
                              className="p-2 text-gray-500 hover:text-red-600"
                              aria-label="Remove row"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    {amountNum > 0 && Math.abs(sumRows - amountNum) >= 0.01 && (
                      <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                        Sum of amounts ({formatCurrency(sumRows, currency)}) must equal total ({formatCurrency(amountNum, currency)}).
                      </p>
                    )}
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={onClose}
                      className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={goToConfirm}
                      disabled={!isValidAmount || !isValidDistribution}
                      className="flex-1 px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Continue
                    </button>
                  </div>
                </>
              )}

              {step === "confirm" && (
                <>
                  <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-sm text-gray-700 dark:text-gray-300">
                    <p className="font-medium mb-2">Receive {formatCurrency(amountNum, currency)} from {customerName}</p>
                    <ul className="list-disc list-inside space-y-1">
                      {rows.filter((r) => r.mode_of_payment && (parseFloat(r.amount) || 0) > 0).map((r, i) => (
                        <li key={i}>
                          {r.mode_of_payment}: {formatCurrency(parseFloat(r.amount) || 0, currency)}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-gray-600 dark:text-gray-400">Amount will be allocated to invoices by due date (FIFO).</p>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setStep("amount")}
                      className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={handleSubmit}
                      disabled={loadingSubmit}
                      className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {loadingSubmit ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          Submitting...
                        </>
                      ) : (
                        <>
                          <CheckCircle className="w-5 h-5" />
                          Confirm
                        </>
                      )}
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {!loadingPrepare && paymentModes.length === 0 && !prepareError && (
            <p className="text-sm text-gray-500 dark:text-gray-400">No payment modes available. Check POS profile.</p>
          )}
        </div>
      </div>
    </div>
  );
}
