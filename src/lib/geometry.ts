import type { Frame } from './data';

export const PITCH_W = 105;
export const PITCH_H = 68;
export const FPS = 5;

/** Players per frame indexed by id for O(1) lookup. */
export function indexFrame(frame: Frame): Map<string, { x: number; y: number }> {
  const map = new Map<string, { x: number; y: number }>();
  for (const p of frame.players) map.set(p.id, { x: p.x, y: p.y });
  return map;
}

/** Trail of past positions for one player: up to `count` frames back. */
export function playerTrail(
  frames: Frame[],
  frameIdx: number,
  playerId: string,
  count: number,
): { x: number; y: number }[] {
  const trail: { x: number; y: number }[] = [];
  const start = Math.max(0, frameIdx - count + 1);
  for (let i = start; i <= frameIdx; i += 1) {
    const found = frames[i].players.find((p) => p.id === playerId);
    if (found) trail.push({ x: found.x, y: found.y });
  }
  return trail;
}

/** Average position per player over sampled frames (pass-network layout). */
export function averagePositions(frames: Frame[]): Map<string, { x: number; y: number; n: number }> {
  const acc = new Map<string, { x: number; y: number; n: number }>();
  const step = 10;
  for (let i = 0; i < frames.length; i += step) {
    for (const p of frames[i].players) {
      const cur = acc.get(p.id) ?? { x: 0, y: 0, n: 0 };
      cur.x += p.x;
      cur.y += p.y;
      cur.n += 1;
      acc.set(p.id, cur);
    }
  }
  const out = new Map<string, { x: number; y: number; n: number }>();
  acc.forEach((v, id) => {
    out.set(id, { x: v.x / v.n, y: v.y / v.n, n: v.n });
  });
  return out;
}

/** Heat cells (flat 21x14 array) for the window containing time t. */
export function heatForTime(
  windows: { t0: number; t1: number; cells: number[] }[],
  t: number,
): number[] | null {
  for (const w of windows) {
    if (t >= w.t0 && t <= w.t1 + 0.001) return w.cells;
  }
  return null;
}

/** Nearest lane set at or before time t. */
export function lanesForTime<T extends { t: number }>(sets: T[], t: number): T | null {
  let best: T | null = null;
  for (const s of sets) {
    if (s.t <= t + 0.001) best = s;
    else break;
  }
  return best;
}
