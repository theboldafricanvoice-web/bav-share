export type BillsPayStartPaymentSessionInput = {
  orderId: string;
  orderRef: string;
  amount: number;
  currency: string;
  email?: string | null;
};

export type BillsPayStartPaymentSessionResult = {
  paymentProvider: string;
  mode: "manual_entry" | "redirect_url";
  paymentReference: string;
  checkoutUrl?: string | null;
  externalTransactionId?: string | null;
  message?: string | null;
  raw: Record<string, unknown>;
};

export type BillsPayPaymentProviderReadiness = {
  ready: boolean;
  issues: string[];
};

export interface BillsPayPaymentProviderAdapter {
  providerCode: string;
  getReadiness?(): BillsPayPaymentProviderReadiness;
  startPaymentSession(
    input: BillsPayStartPaymentSessionInput
  ): Promise<BillsPayStartPaymentSessionResult>;
}
