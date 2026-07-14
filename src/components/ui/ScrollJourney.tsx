"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "framer-motion";

/**
 * Scroll Journey Line — an atmospheric thread winding down the page center.
 *
 * A gentle S-curve is anchored to the five real sections (Hero → Work → About
 * → Certificates → Contact); it draws itself in gold as the page scrolls, with
 * a small dot travelling the exact scroll position along the curve. No captions
 * or labels — the waypoints are invisible geometry anchors, nothing more.
 *
 * Spanning the real page:
 *  - The container is `position: absolute` at the document origin (its `<body>`
 *    parent is unpositioned, so `top:0` + a measured `scrollHeight` height makes
 *    it cover the entire multi-thousand-pixel page, scrolling with content).
 *    NOT `fixed` — that would trap the whole curve inside one viewport.
 *  - Waypoint Y positions are measured from each section's real document
 *    position (`getBoundingClientRect().top + scrollY`), re-measured on resize
 *    and after late layout shifts (image loads) via a ResizeObserver + `load`.
 *  - X positions oscillate ±a few % around the page's horizontal centre, so the
 *    curve weaves down the middle behind the centred content column.
 *
 * Layering: the shader background sits at `-z-10` (inside an unpositioned
 * wrapper, so it participates in the root stacking context); this line sits at
 * `-z-[1]`, which paints above the shader (−1 > −10) but below all page content
 * (z:0/auto). Only this element's own z-index is set — the shader and content
 * layers are untouched. `pointer-events: none` + `aria-hidden` keep it inert.
 *
 * Scroll mechanics reuse the site pattern (see `ScrollProgress`): `useScroll` →
 * `useSpring` → the smoothed progress drives BOTH the stroke reveal
 * (`stroke-dashoffset`) and the dot (`getPointAtLength`) from the same value and
 * the same measured length, so they can never desync. Under
 * `prefers-reduced-motion` the spring is dropped and both snap to scroll.
 *
 * Hidden below `lg` — a desktop storytelling device.
 */

interface Waypoint {
  x: number;
  y: number;
}

// Per-section anchors. `xFrac` is the fraction of viewport width the waypoint
// sits at (oscillating around 0.5); `yFrac` is how far down its own section the
// waypoint anchors (first near the top of Hero, last near the bottom of
// Contact). Section ids are the existing `<section id=…>` anchors.
const SECTIONS: { id: string; xFrac: number; yFrac: number }[] = [
  { id: "home", xFrac: 0.46, yFrac: 0.35 },
  { id: "work", xFrac: 0.55, yFrac: 0.5 },
  { id: "about", xFrac: 0.45, yFrac: 0.5 },
  { id: "certificates", xFrac: 0.55, yFrac: 0.5 },
  { id: "contact", xFrac: 0.48, yFrac: 0.82 },
];

/**
 * Smooth cubic-bezier path through the waypoints. Each segment's control points
 * sit at the vertical midpoint between neighbours (sharing each end's x), so the
 * curve flows through every waypoint without kinking.
 */
function buildPath(points: Waypoint[]): string {
  if (points.length < 2) return "";
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const midY = (prev.y + curr.y) / 2;
    d += ` C ${prev.x.toFixed(2)} ${midY.toFixed(2)}, ${curr.x.toFixed(
      2
    )} ${midY.toFixed(2)}, ${curr.x.toFixed(2)} ${curr.y.toFixed(2)}`;
  }
  return d;
}

export default function ScrollJourney() {
  const prefersReduced = useReducedMotion();
  const { scrollYProgress } = useScroll();

  const smoothed = useSpring(scrollYProgress, {
    stiffness: 100,
    damping: 30,
    restDelta: 0.001,
  });
  // Single source of truth for both the stroke reveal and the dot.
  const progress = prefersReduced ? scrollYProgress : smoothed;

  const pathRef = useRef<SVGPathElement>(null);

  // Document-space dimensions + measured waypoints.
  const [dims, setDims] = useState<{ w: number; h: number; points: Waypoint[] }>(
    { w: 0, h: 0, points: [] }
  );

  useEffect(() => {
    const measure = (): void => {
      const w = window.innerWidth;
      const h = document.documentElement.scrollHeight;
      const points: Waypoint[] = [];
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        const top = rect.top + window.scrollY;
        points.push({
          x: w * s.xFrac,
          y: top + rect.height * s.yFrac,
        });
      }
      setDims({ w, h, points });
    };

    measure();

    // Re-measure on any layout change: viewport resize, and late content/image
    // loads that shift section positions or grow the page.
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    window.addEventListener("resize", measure);
    window.addEventListener("load", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("load", measure);
    };
  }, []);

  const pathD = useMemo(() => buildPath(dims.points), [dims.points]);

  // Path length feeds the dash-based reveal; recomputed whenever the path (and
  // therefore the geometry) changes — never hardcoded.
  const [length, setLength] = useState(0);
  useEffect(() => {
    const path = pathRef.current;
    if (!path || !pathD) {
      setLength(0);
      return;
    }
    setLength(path.getTotalLength());
  }, [pathD]);

  // progress 0 → dashoffset = length (undrawn); 1 → 0 (fully drawn).
  const dashoffset = useTransform(progress, [0, 1], [length, 0]);

  // Traveling dot — same `progress`, same `length`, so it is locked to the
  // stroke reveal at any scroll speed.
  const dotX = useMotionValue(0);
  const dotY = useMotionValue(0);
  const syncDot = (v: number): void => {
    const path = pathRef.current;
    if (!path || length <= 0) return;
    const pt = path.getPointAtLength(Math.max(0, Math.min(1, v)) * length);
    dotX.set(pt.x);
    dotY.set(pt.y);
  };
  useMotionValueEvent(progress, "change", syncDot);
  // Prime the dot after each (re)measure — the change event only fires on move.
  useEffect(() => {
    syncDot(progress.get());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [length, pathD]);

  const ready = dims.w > 0 && dims.h > 0 && pathD !== "";

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-0 top-0 -z-[1] hidden w-full lg:block"
      style={{ height: dims.h || "100%" }}
    >
      {ready && (
        <svg
          width={dims.w}
          height={dims.h}
          viewBox={`0 0 ${dims.w} ${dims.h}`}
          fill="none"
          className="absolute inset-0"
        >
          <defs>
            <linearGradient id="journey-gradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#a87f2a" />
              <stop offset="0.5" stopColor="#d4a843" />
              <stop offset="1" stopColor="#f0c75e" />
            </linearGradient>
          </defs>

          {/* Road ahead — very faint, always fully visible. */}
          <path
            d={pathD}
            stroke="rgba(255,255,255,0.05)"
            strokeWidth={2}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />

          {/* Drawn portion — subtle gold, sits behind text (~35% opacity). */}
          <motion.path
            ref={pathRef}
            d={pathD}
            stroke="url(#journey-gradient)"
            strokeWidth={2}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            opacity={0.35}
            style={{ strokeDasharray: length, strokeDashoffset: dashoffset }}
          />

          {/* Traveling dot — a touch more present than the stroke (~60%). */}
          <motion.circle
            cx={dotX}
            cy={dotY}
            r={5}
            fill="#f0c75e"
            opacity={0.6}
          />
        </svg>
      )}
    </div>
  );
}
