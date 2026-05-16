export const TOPUP_ORDER_STATUSES = [
  "draft",
  "pending_payment",
  "payment_failed",
  "payment_verified",
  "processing_topup",
  "topup_successful",
  "topup_failed",
  "payment_verifying",
  "paid",
  "fulfillment_queued",
  "fulfillment_in_progress",
  "fulfilled",
  "failed",
  "refund_pending",
  "refunded",
  "support_review",
  "cancelled",
  "manual_review",
] as const;

export const TOPUP_PAYMENT_STATUSES = [
  "initiated",
  "pending",
  "verified",
  "failed",
  "reversed",
] as const;

export const TOPUP_FULFILLMENT_STATUSES = [
  "not_started",
  "queued",
  "in_progress",
  "delivered",
  "provider_failed",
  "unknown",
  "manual_review",
] as const;

export const TOPUP_SUPPORT_CASE_STATUSES = [
  "open",
  "investigating",
  "awaiting_provider",
  "resolved",
  "refund_approved",
  "closed",
] as const;

export const TOPUP_SUPPORT_CASE_CATEGORIES = [
  "not_delivered",
  "wrong_bundle",
  "wrong_network",
  "duplicate_charge",
  "refund_request",
  "other",
] as const;

export type TopupOrderStatus = (typeof TOPUP_ORDER_STATUSES)[number];
export type TopupPaymentStatus = (typeof TOPUP_PAYMENT_STATUSES)[number];
export type TopupFulfillmentStatus = (typeof TOPUP_FULFILLMENT_STATUSES)[number];
export type TopupSupportCaseStatus =
  (typeof TOPUP_SUPPORT_CASE_STATUSES)[number];
export type TopupSupportCaseCategory =
  (typeof TOPUP_SUPPORT_CASE_CATEGORIES)[number];

export const TOPUP_CANONICAL_STATUS_ALIASES = {
  pending_payment: "pending_payment",
  payment_failed: "payment_failed",
  payment_verified: "payment_verified",
  processing_topup: "processing_topup",
  topup_successful: "topup_successful",
  topup_failed: "topup_failed",
  refund_pending: "refund_pending",
  refunded: "refunded",
  support_review: "support_review",
  payment_verifying: "payment_verified",
  paid: "payment_verified",
  fulfillment_queued: "processing_topup",
  fulfillment_in_progress: "processing_topup",
  fulfilled: "topup_successful",
  failed: "topup_failed",
  manual_review: "support_review",
  cancelled: "payment_failed",
  draft: "pending_payment",
} as const;

export function toCanonicalTopupOrderStatus(
  status: string | null | undefined
): string {
  if (!status) return "pending_payment";

  return (
    TOPUP_CANONICAL_STATUS_ALIASES[
      status as keyof typeof TOPUP_CANONICAL_STATUS_ALIASES
    ] ?? status
  );
}

export function isPendingTopupPaymentState(status: string | null | undefined) {
  return status === "pending_payment" || status === "payment_verifying";
}

export function isVerifiedTopupPaymentState(status: string | null | undefined) {
  return status === "payment_verified" || status === "paid";
}

export function isProcessingTopupState(status: string | null | undefined) {
  return (
    status === "processing_topup" ||
    status === "fulfillment_queued" ||
    status === "fulfillment_in_progress"
  );
}
