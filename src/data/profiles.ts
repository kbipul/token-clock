import type { TrafficProfile } from "../lib/types";

const z = () => new Array(24).fill(0);
const at = (pairs: Record<number, number>): number[] => {
  const a = z();
  for (const [h, v] of Object.entries(pairs)) a[Number(h)] = v;
  return a;
};

/**
 * Token volumes are output tokens per local hour. The shapes matter more than
 * the absolute numbers — swap in your own and the arithmetic follows.
 */
export const PROFILES: TrafficProfile[] = [
  {
    id: "india-saas",
    name: "India SaaS product (IST working day)",
    blurb:
      "Interactive traffic that follows the Indian working day, plus a nightly re-embedding job and a morning digest run — both scheduled at 07:00 and 08:00 IST, which is exactly inside DeepSeek's first peak window.",
    workloads: [
      {
        id: "interactive",
        name: "Interactive product traffic",
        deferrable: false,
        maxShiftHours: 0,
        hourlyOutputTokens: [
          2_000_000, 1_000_000, 1_000_000, 1_000_000, 2_000_000, 3_000_000,
          5_000_000, 8_000_000, 14_000_000, 22_000_000, 30_000_000, 36_000_000,
          40_000_000, 38_000_000, 39_000_000, 37_000_000, 33_000_000,
          28_000_000, 22_000_000, 16_000_000, 11_000_000, 8_000_000,
          5_000_000, 3_000_000,
        ],
      },
      {
        id: "reembed",
        name: "Nightly corpus re-embedding",
        deferrable: true,
        maxShiftHours: 6,
        hourlyOutputTokens: at({ 7: 180_000_000 }),
      },
      {
        id: "digest",
        name: "Daily account digests",
        deferrable: true,
        maxShiftHours: 4,
        hourlyOutputTokens: at({ 8: 60_000_000 }),
      },
    ],
  },
  {
    id: "us-west",
    name: "US West Coast product (PT working day)",
    blurb:
      "The same shape of business, eight and a half hours the other way. Almost none of the US working day lands in DeepSeek's peak windows — the identical traffic costs a different amount purely because of where your users live.",
    workloads: [
      {
        id: "interactive",
        name: "Interactive product traffic",
        deferrable: false,
        maxShiftHours: 0,
        hourlyOutputTokens: [
          3_000_000, 2_000_000, 1_000_000, 1_000_000, 1_000_000, 2_000_000,
          4_000_000, 9_000_000, 18_000_000, 28_000_000, 35_000_000, 38_000_000,
          36_000_000, 39_000_000, 40_000_000, 37_000_000, 31_000_000,
          24_000_000, 18_000_000, 14_000_000, 11_000_000, 8_000_000,
          6_000_000, 4_000_000,
        ],
      },
      {
        id: "reembed",
        name: "Nightly corpus re-embedding",
        deferrable: true,
        maxShiftHours: 6,
        hourlyOutputTokens: at({ 2: 180_000_000 }),
      },
      {
        id: "digest",
        name: "Daily account digests",
        deferrable: true,
        maxShiftHours: 4,
        hourlyOutputTokens: at({ 6: 60_000_000 }),
      },
    ],
  },
  {
    id: "batch",
    name: "Always-on batch pipeline",
    blurb:
      "A document-processing pipeline with no human waiting on it. Every token is deferrable, so this is the best case for time-shifting — and the clearest look at what the peak/off-peak split is actually worth.",
    workloads: [
      {
        id: "pipeline",
        name: "Document processing pipeline",
        deferrable: true,
        maxShiftHours: 12,
        hourlyOutputTokens: new Array(24).fill(50_000_000),
      },
      {
        id: "oncall",
        name: "On-call alert summarisation",
        deferrable: false,
        maxShiftHours: 0,
        hourlyOutputTokens: new Array(24).fill(2_000_000),
      },
    ],
  },
];

export function profileById(id: string): TrafficProfile {
  const p = PROFILES.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown profile: ${id}`);
  return p;
}
