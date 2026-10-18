/** Format seconds as mm:ss, e.g. 192.4 -> "03:12". */
export function formatT(t: number): string {
  const clamped = Math.max(0, t);
  const minutes = Math.floor(clamped / 60);
  const seconds = Math.floor(clamped % 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** Parse "mm:ss", "m:ss" or raw seconds into seconds. Returns null if invalid. */
export function parseT(input: string, maxSeconds = 600): number | null {
  const trimmed = input.trim();
  const mmss = trimmed.match(/^(\d{1,3}):(\d{1,2}(?:\.\d+)?)$/);
  if (mmss) {
    const minutes = Number(mmss[1]);
    const seconds = Number(mmss[2]);
    if (seconds >= 60 || minutes * 60 + seconds > maxSeconds) return null;
    return minutes * 60 + seconds;
  }
  const raw = Number(trimmed);
  if (Number.isFinite(raw) && raw >= 0 && raw <= maxSeconds) return raw;
  return null;
}
