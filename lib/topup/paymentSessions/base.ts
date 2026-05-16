export type TopupStartPaymentSessionInput = {
  orderId: string;
  orderRef: string;
  amount: number;
  currency: string;
  email?: string | null;
};

export type TopupStartPaymentSessionResult = {
  paymentProvider: string;
  mode: "manual_entry" | "redirect_url";
  paymentReference: string;
  checkoutUrl?: string | null;
  externalTransactionId?: string | null;
  message?: string | null;
  raw: Record<string, unknown>;
};

export type TopupPaymentProviderReadiness = {
  ready: boolean;
  issues: string[];
};

export interface TopupPaymentProviderAdapter {
  providerCode: string;
  getReadiness?(): TopupPaymentProviderReadiness;
  startPaymentSession(
    input: TopupStartPaymentSessionInput
  ): Promise<TopupStartPaymentSessionResult>;
}
