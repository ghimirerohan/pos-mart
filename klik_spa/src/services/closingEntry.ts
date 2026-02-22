import { useState } from "react";

interface ClosingBalance {
  mode_of_payment: string;
  closing_amount: number;
}

interface UseCreateClosingReturn {
  createClosingEntry: (
    closingBalance: ClosingBalance[],
    totalCreditGiven?: number
  ) => Promise<void>;
  isCreating: boolean;
  error: string | null;
  success: boolean;
}

export function useCreatePOSClosingEntry(): UseCreateClosingReturn {
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const createClosingEntry = async (
    closingBalance: ClosingBalance[],
    totalCreditGiven: number = 0
  ) => {
    setIsCreating(true);
    setError(null);
    setSuccess(false);
    const csrfToken = window.csrf_token;

    try {
      const res = await fetch(
        "/api/method/klik_pos.api.pos_entry.create_closing_entry",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Frappe-CSRF-Token": csrfToken,
            Accept: "application/json",
          },
          body: JSON.stringify({
            closing_balance: closingBalance,
            total_credit_given: totalCreditGiven,
          }),
          credentials: "include",
        }
      );

      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        const serverMsg = errorData?._server_messages || errorData?.exc;
        throw new Error(
          serverMsg
            ? typeof serverMsg === "string"
              ? serverMsg
              : JSON.stringify(serverMsg)
            : `HTTP ${res.status}: ${res.statusText}`
        );
      }

      const data = await res.json();

      if (data.message) {
        setSuccess(true);
      } else {
        throw new Error(
          data._server_messages || "Failed to create closing entry"
        );
      }
      //eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      console.error("Error creating POS Closing Entry:", err);
      setError(err.message || "Unexpected error occurred");
      throw err;
    } finally {
      setIsCreating(false);
    }
  };

  return {
    createClosingEntry,
    isCreating,
    error,
    success,
  };
}
