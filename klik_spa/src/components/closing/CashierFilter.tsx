import { User, Users } from "lucide-react";
import type { Cashier } from "../../hooks/usePaymentTransactions";

interface CashierFilterProps {
  cashiers: Cashier[];
  selectedCashier?: string;
  onCashierChange: (cashierId: string) => void;
  isAdmin: boolean;
}

export default function CashierFilter({
  cashiers,
  selectedCashier,
  onCashierChange,
  isAdmin,
}: CashierFilterProps) {
  if (!isAdmin || cashiers.length === 0) {
    return null;
  }

  const currentSelection = selectedCashier || "my_session";

  return (
    <div className="flex items-center space-x-2">
      <div className="flex items-center space-x-1 text-gray-500 dark:text-gray-400">
        {currentSelection === "all" ? (
          <Users className="w-4 h-4" />
        ) : (
          <User className="w-4 h-4" />
        )}
        <span className="text-sm font-medium hidden sm:inline">Cashier:</span>
      </div>
      <select
        value={currentSelection}
        onChange={(e) => onCashierChange(e.target.value)}
        className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm min-w-[150px]"
      >
        <option value="my_session">My Session</option>
        {cashiers.map((cashier) => (
          <option key={cashier.user_id} value={cashier.user_id}>
            {cashier.name}
          </option>
        ))}
      </select>
    </div>
  );
}
