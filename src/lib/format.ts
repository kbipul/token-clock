export function usd(n: number): string {
  if (n === 0) return "$0.00";
  if (Math.abs(n) < 0.01) return `$${n.toFixed(4)}`;
  if (Math.abs(n) < 1000) return `$${n.toFixed(2)}`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function pct(fraction: number, digits = 1): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function tokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(Math.round(n));
}

export function hourLabel(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

/** Signed multiple, e.g. 4.7 for "4.7x more expensive". */
export function multiple(from: number, to: number): string {
  if (from === 0) return "—";
  return `${(to / from).toFixed(1)}x`;
}

/**
 * Which of the two levers is actually bigger on THIS input.
 *
 * The intra-day and weekend levers can land on exactly the same number: both
 * move deferrable tokens to the off-peak rate, and there is no third, cheaper
 * rate to reach. On the bundled India SaaS profile they tie to the cent, so
 * the old hard-coded "the smaller lever" printed a false comparison next to a
 * correct figure. Compute the relation instead of asserting it.
 */
export function leverNote(
  intradaySavedUsd: number,
  weekendSavedUsd: number,
  noWeekendEdge: boolean,
  epsilonUsd = 0.005,
): string {
  if (noWeekendEdge) return "the only lever on this model";
  if (intradaySavedUsd > weekendSavedUsd + epsilonUsd) return "the larger lever";
  if (intradaySavedUsd < weekendSavedUsd - epsilonUsd) return "the smaller lever";
  return "the same saving, on a tighter schedule";
}
