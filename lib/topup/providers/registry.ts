import { dingConnectTopupAggregatorAdapter } from "@/lib/topup/providers/dingconnect";
import type { TopupAggregatorAdapter } from "@/lib/topup/providers/base";
import { manualTopupAggregatorAdapter } from "@/lib/topup/providers/manual";
import { reloadlyTopupAggregatorAdapter } from "@/lib/topup/providers/reloadly";

const TOPUP_AGGREGATOR_ADAPTERS: TopupAggregatorAdapter[] = [
  dingConnectTopupAggregatorAdapter,
  reloadlyTopupAggregatorAdapter,
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
