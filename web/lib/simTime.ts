// V2.2c — sim-time rendering for user-facing UI (palette window labels, overlay badges, RunCard
// chips). CLIENT MIRROR of python/src/demand_profiles.py fmt_sim_time/fmt_window: the calibrated
// profile's t=0 is 07:00 (clock times); every other profile renders plain sim forms. Keep the two
// in lockstep — the strings are Playwright-pinned (no vitest in this repo).

const CLOCK_ANCHOR_MIN: Record<string, number> = { calibrated_am_peak: 7 * 60 };

export function fmtSimTime(tS: number, profile: string | undefined): string {
  const anchor = profile ? CLOCK_ANCHOR_MIN[profile] : undefined;
  if (anchor === undefined) return `t=${Math.round(tS)} s`;
  const totalMin = anchor + Math.floor(tS / 60);
  const hh = String(Math.floor(totalMin / 60) % 24).padStart(2, '0');
  const mm = String(totalMin % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Compact range form for badges/chips: "07:15–09:00" (calibrated) / "t=600–2400 s" (synthetic). */
export function fmtWindowRange(w: { start_s: number; end_s: number }, profile: string | undefined): string {
  const anchor = profile ? CLOCK_ANCHOR_MIN[profile] : undefined;
  if (anchor === undefined) return `t=${Math.round(w.start_s)}–${Math.round(w.end_s)} s`;
  return `${fmtSimTime(w.start_s, profile)}–${fmtSimTime(w.end_s, profile)}`;
}
