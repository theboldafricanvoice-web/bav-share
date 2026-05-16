import type { BillsPayProviderAdapter } from "@/lib/billsPay/providers/base";
import { manualBillsPayProviderAdapter } from "@/lib/billsPay/providers/manual";

const BILLS_PAY_PROVIDER_ADAPTERS: BillsPayProviderAdapter[] = [
  manualBillsPayProviderAdapter,
];

export function getBillsPayProviderAdapter(providerCode: string) {
  return (
    BILLS_PAY_PROVIDER_ADAPTERS.find(
      (adapter) => adapter.providerCode === providerCode
    ) ?? null
  );
}

export function getBillsPayProviderAdapters() {
  return BILLS_PAY_PROVIDER_ADAPTERS;
}
