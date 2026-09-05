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
