/** Single row after merging duplicate modes of payment (e.g. two Cash lines). */
export type InvoicePaymentRow = { mode: string; amount: number };

/**
 * Merge `payment_methods` from invoice detail API into unique modes with summed amounts.
 */
export function mergeInvoicePaymentMethods(
  payment_methods?:
    | Array<{ mode_of_payment?: string | null; amount?: number | string | null }>
    | null
): InvoicePaymentRow[] {
  if (!payment_methods?.length) return [];
  const map = new Map<string, number>();
  for (const p of payment_methods) {
    const mode = String(p.mode_of_payment ?? "Unknown").trim() || "Unknown";
    const raw = Number(p.amount ?? 0);
    const amt = Number.isFinite(raw) ? raw : 0;
    map.set(mode, (map.get(mode) || 0) + amt);
  }
  return Array.from(map.entries()).map(([mode, amount]) => ({ mode, amount }));
}
