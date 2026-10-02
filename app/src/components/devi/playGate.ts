// motion gate (pure, testable without a DOM): decides when a Devi mark may play its single animation.
//  - reduced motion or no IntersectionObserver: never play (static frame only)
//  - starts once, when >= 50% visible; offscreen before start: never starts
//  - leaves the viewport mid-play: cancel to the static frame (class removed); never replays
//  - after the animation has finished, leaving changes nothing (fill-mode forwards keeps the final frame)
export const PLAY_MS = 4000; // upper bound of every per-Devi animation (spec: each <= 4 s)

export interface GateEntry { isIntersecting: boolean; intersectionRatio: number }
export interface GateDeps {
  IntersectionObserver?: new (cb: (entries: GateEntry[]) => void, opts: { threshold: number[] }) => {
    observe(el: unknown): void;
    disconnect(): void;
  };
  matchMedia?: (q: string) => { matches: boolean };
  setPlaying: (v: boolean) => void;
  now?: () => number;
}

export function attachPlayGate(el: unknown, deps: GateDeps): () => void {
  const now = deps.now ?? (() => Date.now());
  const reduced = deps.matchMedia ? deps.matchMedia("(prefers-reduced-motion: reduce)").matches : false;
  if (reduced || !deps.IntersectionObserver) return () => {};
  let started = false;
  let startedAt = 0;
  let playing = false;
  const io = new deps.IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const visible = e.isIntersecting && e.intersectionRatio >= 0.5;
        if (visible && !started) {
          started = true;
          playing = true;
          startedAt = now();
          deps.setPlaying(true);
        } else if (!visible && started && playing && now() - startedAt < PLAY_MS) {
          playing = false;
          deps.setPlaying(false); // cancelled mid-play: static frame, no replay
        }
      }
    },
    { threshold: [0, 0.5, 1] }
  );
  io.observe(el);
  return () => io.disconnect();
}

export function prefersReducedMotion(mm?: (q: string) => { matches: boolean }): boolean {
  return mm ? mm("(prefers-reduced-motion: reduce)").matches : false;
}
