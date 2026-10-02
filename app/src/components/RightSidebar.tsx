"use client";

import { PriceWidget } from "@/components/PriceWidget";
import { TrendingCoins } from "@/components/TrendingCoins";
import { BigNews } from "@/components/explain/BigNews";

export function RightSidebar() {
  return (
    <div className="flex flex-col">
      <BigNews />
      <PriceWidget />
      <TrendingCoins />
    </div>
  );
}