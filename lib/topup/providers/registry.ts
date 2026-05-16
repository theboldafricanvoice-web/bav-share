import type { TopupAggregatorAdapter } from "@/lib/topup/providers/base";
import { manualTopupAggregatorAdapter } from "@/lib/topup/providers/manual";

const TOPUP_AGGREGATOR_ADAPTERS: TopupAggregatorAdapter[] = [
  manualTopupAggregatorAdapter,
];

export function getTopupAggregatorAdapter(providerCode: string) {
  return (
    TOPUP_AGGREGATOR_ADAPTERS.find(
      (adapter) => adapter.providerCode === providerCode
    ) ?? null
  );
}

export function getTopupAggregatorAdapters() {
  return TOPUP_AGGREGATOR_ADAPTERS;
}
