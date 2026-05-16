export const BILLS_PAY_ORDER_STATUSES = [
  "pending_payment",
  "payment_failed",
  "payment_verified",
  "processing_bill_payment",
  "bill_payment_successful",
  "bill_payment_failed",
  "refund_pending",
  "refunded",
  "support_review",
] as const;

export const BILLS_PAY_PAYMENT_STATUSES = [
  "initiated",
  "pending",
  "verified",
  "failed",
  "reversed",
] as const;

export const BILLS_PAY_FULFILLMENT_STATUSES = [
  "not_started",
  "queued",
  "in_progress",
  "paid_to_biller",
  "provider_failed",
  "unknown",
  "manual_review",
] as const;

export const BILLS_PAY_SUPPORT_CASE_STATUSES = [
  "open",
  "investigating",
  "awaiting_provider",
  "resolved",
  "refund_approved",
  "closed",
] as const;

export const BILLS_PAY_SUPPORT_CASE_CATEGORIES = [
  "not_paid_to_biller",
  "wrong_account",
  "wrong_amount",
  "duplicate_charge",
  "refund_request",
  "other",
] as const;

export type BillsPayOrderStatus = (typeof BILLS_PAY_ORDER_STATUSES)[number];
export type BillsPayPaymentStatus = (typeof BILLS_PAY_PAYMENT_STATUSES)[number];
export type BillsPayFulfillmentStatus =
  (typeof BILLS_PAY_FULFILLMENT_STATUSES)[number];
export type BillsPaySupportCaseStatus =
  (typeof BILLS_PAY_SUPPORT_CASE_STATUSES)[number];
export type BillsPaySupportCaseCategory =
  (typeof BILLS_PAY_SUPPORT_CASE_CATEGORIES)[number];

export function toCanonicalBillsPayOrderStatus(
  status: string | null | undefined
): string {
  if (!status) return "pending_payment";
  return status;
}
