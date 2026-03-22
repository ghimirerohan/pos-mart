/** Tailwind classes for profit / P&L values: green if non-negative, red if negative */
export function profitColorClass(value: number): string {
  return value >= 0
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-red-600 dark:text-red-400"
}
