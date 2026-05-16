export type NormalizedBillsPayBiller = {
  providerCode: string;
  categoryCode: string;
  countryCode: string;
  billerCode: string;
  name: string;
  description?: string | null;
  currency: string;
  supportsLookup: boolean;
  supportsFixedAmount: boolean;
  supportsVariableAmount: boolean;
  minAmount?: number | null;
  maxAmount?: number | null;
  requiredFields: string[];
  metadata?: Record<string, unknown>;
};

export type CustomerValidationResult = {
  valid: boolean;
  customerName?: string | null;
  minimumAmount?: number | null;
  maximumAmount?: number | null;
  providerMessage?: string | null;
  raw: Record<string, unknown>;
};

export type BillPaymentInput = {
  orderRef: string;
  providerRequestRef: string;
  countryCode: string;
  billerCode: string;
  amount: number;
  currency: string;
  accountReference: string;
  fields?: Record<string, string>;
};

export type BillPaymentResult = {
  accepted: boolean;
  providerTransactionRef?: string | null;
  providerStatus: "accepted" | "pending" | "paid_to_biller" | "failed" | "unknown";
  providerMessage?: string | null;
  raw: Record<string, unknown>;
};

export type BillPaymentStatusResult = {
  providerStatus: "pending" | "paid_to_biller" | "failed" | "unknown";
  providerRequestRef?: string | null;
  providerTransactionRef?: string | null;
  providerMessage?: string | null;
  raw: Record<string, unknown>;
};

export interface BillsPayProviderAdapter {
  providerCode: string;
  getSupportedCountries(): Promise<string[]>;
  getBillersByCountry(countryCode: string): Promise<NormalizedBillsPayBiller[]>;
  validateCustomer(input: {
    billerCode: string;
    countryCode: string;
    accountReference: string;
    fields?: Record<string, string>;
  }): Promise<CustomerValidationResult>;
  payBill(input: BillPaymentInput): Promise<BillPaymentResult>;
  checkTransactionStatus(
    providerTransactionId: string
  ): Promise<BillPaymentStatusResult>;
  parseWebhook?(
    payload: unknown,
    headers: Headers
  ): Promise<BillPaymentStatusResult | null>;
}
