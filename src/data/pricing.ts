import type { ModelPricing, Zone } from "../lib/types";

const H = (h: number, m = 0) => h * 60 + m;

/**
 * DeepSeek's peak windows, as published: 01:00–04:00 and 06:00–10:00 UTC.
 * In Beijing time (UTC+8) that is 09:00–12:00 and 14:00–18:00 — the Chinese
 * working day. Everything outside those seven hours is off-peak.
 */
const DEEPSEEK_PEAK = [
  { startMin: H(1), endMin: H(4) },
  { startMin: H(6), endMin: H(10) },
];

/**
 * Monday–Friday only. The launch scheme (16 Aug 2026) ran the peak bands seven
 * days a week; DeepSeek amended it from 00:00 Beijing time on 23 Aug 2026 so
 * that Saturday and Sunday bill entirely at the off-peak rate.
 *
 * Encoded as UTC weekdays. Safe, because every peak window above sits inside
 * 01:00–10:00 UTC — adding the +8h Beijing offset keeps those minutes on the
 * same calendar day, so the Beijing weekend and the UTC weekend exempt exactly
 * the same minutes. See peakFractionForLocalHourOnDay for the local-day trap.
 */
const DEEPSEEK_PEAK_DAYS = [1, 2, 3, 4, 5];

/** The scheme exactly as it launched on 16 Aug: peak bands every day of the week. */
const LAUNCH_WEEK_PEAK_DAYS = [0, 1, 2, 3, 4, 5, 6];

const DEEPSEEK_SOURCE =
  "TechNode / Quartz, 13–14 Aug 2026 (bands, effective 16:00 UTC 16 Aug 2026); Bloomberg / PANews / 36Kr, 23 Aug 2026 (weekends moved to off-peak from 00:00 Beijing time, 23 Aug 2026)";

/**
 * Every figure below is USD per 1,000,000 OUTPUT tokens.
 *
 * Output tokens only, deliberately. The repricing coverage quotes output rates;
 * per-band INPUT rates were not published in the sources used here, and this
 * catalogue does not carry numbers it cannot cite. See the honesty note in the
 * README and the UI.
 */
export const MODELS: ModelPricing[] = [
  {
    id: "deepseek-v4-flash",
    provider: "DeepSeek",
    name: "V4-Flash",
    outputPerMTok: { peak: 1.32, offpeak: 0.66 },
    peakWindowsUtc: DEEPSEEK_PEAK,
    peakDaysUtc: DEEPSEEK_PEAK_DAYS,
    previousFlatOutputPerMTok: 0.28,
    effectiveFrom: "2026-08-16T16:00:00Z, weekend exemption from 2026-08-23",
    source: DEEPSEEK_SOURCE,
    note: "Off-peak is exactly half of peak. Peak is ~4.7x the previous flat rate. Peak bands run Mon-Fri only; the whole weekend is off-peak.",
  },
  {
    id: "deepseek-v4-pro",
    provider: "DeepSeek",
    name: "V4-Pro",
    outputPerMTok: { peak: 3.96, offpeak: 1.98 },
    peakWindowsUtc: DEEPSEEK_PEAK,
    peakDaysUtc: DEEPSEEK_PEAK_DAYS,
    previousFlatOutputPerMTok: 0.87,
    effectiveFrom: "2026-08-16T16:00:00Z, weekend exemption from 2026-08-23",
    source: DEEPSEEK_SOURCE,
    note: "Off-peak is exactly half of peak. Peak is ~4.6x the previous flat rate. Peak bands run Mon-Fri only; the whole weekend is off-peak.",
  },
  {
    id: "deepseek-v4-flash-launch",
    provider: "DeepSeek",
    name: "V4-Flash (launch week: peak 7 days)",
    outputPerMTok: { peak: 1.32, offpeak: 0.66 },
    peakWindowsUtc: DEEPSEEK_PEAK,
    peakDaysUtc: LAUNCH_WEEK_PEAK_DAYS,
    previousFlatOutputPerMTok: 0.28,
    effectiveFrom: "2026-08-16T16:00:00Z to 2026-08-23",
    source: DEEPSEEK_SOURCE,
    note: "The scheme as launched, with peak bands every day. Kept so you can measure what the 23 Aug weekend exemption is actually worth on your traffic.",
  },
  {
    id: "deepseek-v4-flash-old",
    provider: "DeepSeek",
    name: "V4-Flash (pre-16 Aug flat rate)",
    outputPerMTok: { peak: 0.28, offpeak: 0.28 },
    peakWindowsUtc: [],
    peakDaysUtc: [],
    previousFlatOutputPerMTok: null,
    effectiveFrom: "before 2026-08-16T16:00:00Z",
    source: DEEPSEEK_SOURCE,
    note: "Kept in the catalogue as the baseline the repricing moved away from.",
  },
];

export const ZONES: Zone[] = [
  { id: "ist", label: "India (IST, UTC+5:30)", offsetMin: 330 },
  { id: "utc", label: "UTC", offsetMin: 0 },
  { id: "cst", label: "China (CST, UTC+8)", offsetMin: 480 },
  { id: "cet", label: "Central Europe (UTC+2)", offsetMin: 120 },
  { id: "et", label: "US Eastern (UTC−4)", offsetMin: -240 },
  { id: "pt", label: "US Pacific (UTC−7)", offsetMin: -420 },
];

export function modelById(id: string): ModelPricing {
  const m = MODELS.find((x) => x.id === id);
  if (!m) throw new Error(`Unknown model: ${id}`);
  return m;
}

export function zoneById(id: string): Zone {
  const z = ZONES.find((x) => x.id === id);
  if (!z) throw new Error(`Unknown zone: ${id}`);
  return z;
}
