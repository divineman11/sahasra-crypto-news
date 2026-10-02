"use client";

import { PriceWidget } from "@/components/PriceWidget";
import { TrendingCoins } from "@/components/TrendingCoins";
import { BigNews } from "@/components/explain/BigNews";
import { UpcomingUnlocks } from "@/components/UpcomingUnlocks";

export function RightSidebar() {
  return (
    <div className="flex flex-col">
      <BigNews />
      <UpcomingUnlocks />
      <PriceWidget />
      <TrendingCoins />
    </div>
  );
}