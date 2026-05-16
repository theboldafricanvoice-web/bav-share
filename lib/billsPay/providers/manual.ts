import type {
  BillPaymentInput,
  BillPaymentResult,
  BillPaymentStatusResult,
  BillsPayProviderAdapter,
  CustomerValidationResult,
  NormalizedBillsPayBiller,
} from "@/lib/billsPay/providers/base";

export const manualBillsPayProviderAdapter: BillsPayProviderAdapter = {
  providerCode: "manual",
  async getSupportedCountries(): Promise<string[]> {
    return ["SL", "NG", "GH", "LR", "GN", "GM", "KE"];
  },
  async getBillersByCountry(_countryCode: string): Promise<NormalizedBillsPayBiller[]> {
    return [];
  },
  async validateCustomer(input): Promise<CustomerValidationResult> {
    return {
      valid: true,
      customerName: `Demo Customer ${input.accountReference.slice(-4) || "0000"}`,
      providerMessage:
        "Manual demo provider accepted this customer reference for sandbox testing.",
      raw: {
        adapter: "manual",
        billerCode: input.billerCode,
        countryCode: input.countryCode,
        accountReference: input.accountReference,
      },
    };
  },
  async payBill(input: BillPaymentInput): Promise<BillPaymentResult> {
    return {
      accepted: true,
      providerTransactionRef: `MANUAL-BILL-${input.providerRequestRef}`,
      providerStatus: "paid_to_biller",
      providerMessage:
        "Manual demo provider marked the bill as paid immediately.",
      raw: {
        adapter: "manual",
        orderRef: input.orderRef,
        providerRequestRef: input.providerRequestRef,
      },
    };
  },
  async checkTransactionStatus(
    providerTransactionId: string
  ): Promise<BillPaymentStatusResult> {
    return {
      providerStatus: "paid_to_biller",
      providerTransactionRef: providerTransactionId,
      providerMessage:
        "Manual demo provider treats this bill payment as completed.",
      raw: {
        adapter: "manual",
        providerTransactionId,
      },
    };
  },
  async parseWebhook(payload, _headers): Promise<BillPaymentStatusResult | null> {
    if (!payload || typeof payload !== "object") return null;
    const maybe = payload as Record<string, unknown>;
    const eventType =
      typeof maybe.eventType === "string" ? maybe.eventType.trim().toLowerCase() : "";
    const providerTransactionRef =
      typeof maybe.providerTransactionRef === "string"
        ? maybe.providerTransactionRef.trim()
        : null;

    const providerStatus =
      eventType === "paid_to_biller"
        ? "paid_to_biller"
        : eventType === "failed"
        ? "failed"
        : eventType === "pending"
        ? "pending"
        : eventType === "unknown"
        ? "unknown"
        : null;

    if (!providerStatus) return null;

    return {
      providerStatus,
      providerRequestRef:
        typeof maybe.providerRequestRef === "string"
          ? maybe.providerRequestRef.trim()
          : null,
      providerTransactionRef,
      providerMessage:
        typeof maybe.providerMessage === "string" ? maybe.providerMessage : null,
      raw: maybe,
    };
  },
};
