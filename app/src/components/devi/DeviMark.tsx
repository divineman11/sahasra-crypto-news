"use client";

import { useEffect, useRef, useState } from "react";
import { DEVI_BY_KEY, type DeviKey } from "./registry";
import { attachPlayGate, prefersReducedMotion } from "./playGate";

// One decorative mark. `title` (hover tooltip) = the respectful "Inspired by ..." line + the meaning line.
// The mark itself is aria-hidden; headings next to it are text-first.
// `play`: allowed to play its single animation once, when >= 50% visible (never with reduced motion).
// `replay`: legend page only; hover / tap / focus replays the animation once more.
export function DeviMark({
  devi, size = 18, play = false, className, tooltip = true, replay = false,
}: {
  devi: DeviKey; size?: number; play?: boolean; className?: string; tooltip?: boolean; replay?: boolean;
}) {
  const d = DEVI_BY_KEY[devi];
  const Mark = d.Component;
  const ref = useRef<HTMLSpanElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!play || !ref.current) return;
    return attachPlayGate(ref.current, {
      IntersectionObserver: typeof IntersectionObserver !== "undefined" ? (IntersectionObserver as never) : undefined,
      matchMedia: typeof window !== "undefined" ? window.matchMedia.bind(window) : undefined,
      setPlaying,
    });
  }, [play]);

  const again = () => {
    if (!replay || prefersReducedMotion(typeof window !== "undefined" ? window.matchMedia.bind(window) : undefined)) return;
    setPlaying(false);
    window.setTimeout(() => setPlaying(true), 40);
  };

  return (
    <span
      ref={ref}
      className="devi-wrap inline-flex shrink-0 items-center"
      title={tooltip ? `${d.tooltip}\n${d.meaning}\nAbout the ten lenses: /about/devis` : undefined}
      style={{ lineHeight: 0 }}
      onMouseEnter={replay ? again : undefined}
      onClick={replay ? again : undefined}
      onFocus={replay ? again : undefined}
    >
      <Mark size={size} play={playing} className={className} />
    </span>
  );
}
