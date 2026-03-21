import type { BillDiscountMode } from "../../types";

/**
 * Matches klik_pos.api.sales_invoice._compute_pos_additional_discount_amount:
 * line subtotal → coupon → bill % (on post-coupon base) or bill fixed amount.
 */
export function computeBillDiscountBreakdown(
  lineSubtotal: number,
  couponDiscount: number,
  billMode: BillDiscountMode,
  billValue: number
) {
  const coupon = Math.max(0, couponDiscount);
  const N = Math.max(0, lineSubtotal);
  const baseAfterCoupon = Math.max(0, N - coupon);

  let billAmt = 0;
  if (billMode === "percent" && billValue > 0) {
    const pct = Math.min(billValue, 100);
    billAmt = baseAfterCoupon * (pct / 100);
  } else if (billMode === "amount" && billValue > 0) {
    billAmt = Math.min(billValue, baseAfterCoupon);
  }

  let totalAdditionalDiscount = coupon + billAmt;
  if (totalAdditionalDiscount > N) {
    totalAdditionalDiscount = N;
  }

  return {
    lineSubtotal: N,
    couponDiscount: coupon,
    baseAfterCoupon,
    billDiscountAmount: billAmt,
    totalAdditionalDiscount,
    taxableBeforeTax: Math.max(0, baseAfterCoupon - billAmt),
  };
}

/** Payload keys for create_and_submit_invoice / create_draft_invoice */
export function billDiscountPayload(
  mode: BillDiscountMode,
  value: number,
  couponDiscount: number,
  breakdown: { totalAdditionalDiscount: number }
) {
  const type =
    mode === "percent" ? "percent" : mode === "amount" ? "amount" : "";
  return {
    billDiscountType: type,
    billDiscountValue: mode === "none" ? 0 : Math.max(0, value),
    couponDiscount,
    totalAdditionalDiscountAmount: breakdown.totalAdditionalDiscount,
  };
}
