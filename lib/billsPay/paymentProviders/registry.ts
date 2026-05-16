import type { BillsPayPaymentProviderAdapter } from "@/lib/billsPay/paymentProviders/base";
import { manualBillsPayPaymentProviderAdapter } from "@/lib/billsPay/paymentProviders/manual";
import { stripeBillsPayPaymentProviderAdapter } from "@/lib/billsPay/paymentProviders/stripe";

const BILLS_PAY_PAYMENT_PROVIDER_ADAPTERS: BillsPayPaymentProviderAdapter[] = [
  manualBillsPayPaymentProviderAdapter,
  stripeBillsPayPaymentProviderAdapter,
];

export function getBillsPayPaymentProviderAdapter(providerCode: string) {
  return (
    BILLS_PAY_PAYMENT_PROVIDER_ADAPTERS.find(
      (adapter) => adapter.providerCode === providerCode
    ) ?? null
  );
}

export function getBillsPayPaymentProviderReadiness(providerCode: string) {
  const adapter = getBillsPayPaymentProviderAdapter(providerCode);
  if (!adapter) {
    return {
      ready: false,
      issues: ["provider_not_found"],
    };
  }

  return (
    adapter.getReadiness?.() ?? {
      ready: true,
      issues: [],
    }
  );
}

export function getDefaultBillsPayPaymentProviderCode() {
  const configured = process.env.BILLS_PAY_DEFAULT_PAYMENT_PROVIDER?.trim().toLowerCase();
  return configured || "manual";
}
