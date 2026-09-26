"use client";

import { PriceWidget } from "@/components/PriceWidget";
import { TrendingCoins } from "@/components/TrendingCoins";

export function RightSidebar() {
  return (
    <div className="flex flex-col">
      <PriceWidget />
      <TrendingCoins />
    </div>
  );
}