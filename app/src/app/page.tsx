"use client";

import { useEffect, useState } from "react";
import { TopBar } from "@/components/TopBar";
import { LeftSidebar } from "@/components/LeftSidebar";
import { NewsFeed } from "@/components/NewsFeed";
import { RightSidebar } from "@/components/RightSidebar";

export default function Page() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <div className="p-4 font-mono text-xs text-slate-500">loading terminal…</div>;
  }

  return (
    <div className="flex h-screen flex-col p-4">
      <TopBar />
      {/* V1 review: the shell used to be a fixed 220px + 1fr + 280px grid at every width — at
          1024px that left the feed only ~500px, and FeedRow's own fixed columns + inline ticker
          chips ate nearly all of it, collapsing the title to ~0 width. Now: below `lg` (1024px) the
          left sidebar narrows to 180px; below `xl` (1280px) the right sidebar (Prices/Trending) is
          hidden entirely rather than squeezing the feed — it's still one click away at ≥1280px, and
          hiding it (vs. moving it below the feed) avoids splitting the shell's fixed height across
          two unevenly-sized scroll regions. */}
      <div className="mt-2 grid grid-cols-[180px_minmax(0,1fr)] lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_280px] min-h-0 flex-1 border border-slate-800 rounded">
        <aside className="overflow-y-auto border-r border-slate-800">
          <LeftSidebar />
        </aside>
        <main className="min-w-0 overflow-y-auto">
          <NewsFeed />
        </main>
        <aside className="hidden overflow-y-auto border-l border-slate-800 xl:block">
          <RightSidebar />
        </aside>
      </div>
    </div>
  );
}