import { describe, it, expect } from "vitest";
import { blendedRate, combineHourly, costForHourly } from "../cost";
import { modelById, zoneById } from "../../data/pricing";
import { profileById } from "../../data/profiles";
import type { Workload } from "../types";

const flash = modelById("deepseek-v4-flash");
const flat = modelById("deepseek-v4-flash-old");
const ist = zoneById("ist");
const utc = zoneById("utc");

const wl = (over: Partial<Workload>): Workload => ({
  id: "w",
  name: "w",
  deferrable: false,
  maxShiftHours: 0,
  hourlyOutputTokens: new Array(24).fill(0),
  ...over,
});

describe("combineHourly", () => {
  it("sums workloads into one 24-slot array", () => {
    const a = wl({ id: "a", hourlyOutputTokens: new Array(24).fill(1) });
    const b = wl({ id: "b", hourlyOutputTokens: new Array(24).fill(2) });
    const out = combineHourly([a, b]);
    expect(out).toHaveLength(24);
    expect(out.every((v) => v === 3)).toBe(true);
  });

  it("prefers an override series when one is supplied", () => {
    const a = wl({ id: "a", hourlyOutputTokens: new Array(24).fill(1) });
    const out = combineHourly([a], { a: new Array(24).fill(9) });
    expect(out.every((v) => v === 9)).toBe(true);
  });
});

describe("blendedRate", () => {
  it("returns the peak rate for a fully peak hour", () => {
    const r = blendedRate(2, utc, flash);
    expect(r.peakFraction).toBe(1);
    expect(r.blendedPerMTok).toBeCloseTo(1.32, 9);
  });

  it("returns the off-peak rate for a fully off-peak hour", () => {
    const r = blendedRate(20, utc, flash);
    expect(r.peakFraction).toBe(0);
    expect(r.blendedPerMTok).toBeCloseTo(0.66, 9);
  });

  it("blends a straddling hour proportionally", () => {
    const r = blendedRate(6, ist, flash); // 00:30–01:30 UTC, half peak
    expect(r.peakFraction).toBe(0.5);
    expect(r.blendedPerMTok).toBeCloseTo((1.32 + 0.66) / 2, 9);
  });

  it("is flat all day for a model with no bands", () => {
    for (let h = 0; h < 24; h++) {
      expect(blendedRate(h, ist, flat).blendedPerMTok).toBeCloseTo(0.28, 9);
    }
  });
});

describe("costForHourly", () => {
  it("prices a single million-token hour at exactly the band rate", () => {
    const hourly = new Array(24).fill(0);
    hourly[2] = 1_000_000; // fully peak in UTC
    const r = costForHourly(hourly, utc, flash);
    expect(r.totalTokens).toBe(1_000_000);
    expect(r.totalCostUsd).toBeCloseTo(1.32, 9);
    expect(r.peakExposure).toBeCloseTo(1, 9);
  });

  it("reports zero peak exposure for entirely off-peak traffic", () => {
    const hourly = new Array(24).fill(0);
    hourly[20] = 5_000_000;
    const r = costForHourly(hourly, utc, flash);
    expect(r.totalCostUsd).toBeCloseTo(5 * 0.66, 9);
    expect(r.peakExposure).toBe(0);
  });

  it("keeps peak exposure inside [0, 1] for a real profile", () => {
    const p = profileById("india-saas");
    const r = costForHourly(combineHourly(p.workloads), ist, flash);
    expect(r.peakExposure).toBeGreaterThan(0);
    expect(r.peakExposure).toBeLessThanOrEqual(1);
  });

  it("computes the previous flat-rate comparison when the source has one", () => {
    const hourly = new Array(24).fill(0);
    hourly[2] = 10_000_000;
    const r = costForHourly(hourly, utc, flash);
    expect(r.previousFlatCostUsd).toBeCloseTo(10 * 0.28, 9);
    // The repricing is the whole story: peak is materially more expensive.
    expect(r.totalCostUsd).toBeGreaterThan(r.previousFlatCostUsd!);
  });

  it("returns null for the flat baseline model, which has no predecessor", () => {
    const r = costForHourly(new Array(24).fill(1_000_000), utc, flat);
    expect(r.previousFlatCostUsd).toBeNull();
  });

  it("handles an empty day without dividing by zero", () => {
    const r = costForHourly(new Array(24).fill(0), ist, flash);
    expect(r.totalCostUsd).toBe(0);
    expect(r.peakExposure).toBe(0);
  });

  it("returns one entry per hour, in order", () => {
    const r = costForHourly(new Array(24).fill(1_000), ist, flash);
    expect(r.hours).toHaveLength(24);
    expect(r.hours.map((h) => h.hour)).toEqual(
      Array.from({ length: 24 }, (_, i) => i),
    );
  });

  it("makes the same Indian traffic cheaper on the US Pacific clock", () => {
    // Identical token volumes, read against a different local clock: the
    // Indian working day sits in peak, the Pacific one does not.
    const p = profileById("india-saas");
    const hourly = combineHourly(p.workloads);
    const inIndia = costForHourly(hourly, ist, flash).totalCostUsd;
    const inPacific = costForHourly(hourly, zoneById("pt"), flash).totalCostUsd;
    expect(inPacific).toBeLessThan(inIndia);
  });
});
