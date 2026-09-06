import { describe, it, expect } from "vitest";
import { MODELS, ZONES, modelById, zoneById } from "../../data/pricing";
import { PROFILES, profileById } from "../../data/profiles";

describe("pricing catalogue", () => {
  it("has unique model ids", () => {
    expect(new Set(MODELS.map((m) => m.id)).size).toBe(MODELS.length);
  });

  it("never prices off-peak above peak", () => {
    for (const m of MODELS) {
      expect(m.outputPerMTok.offpeak).toBeLessThanOrEqual(m.outputPerMTok.peak);
    }
  });

  it("keeps banded and flat models internally consistent", () => {
    for (const m of MODELS) {
      if (m.peakWindowsUtc.length === 0) {
        expect(m.outputPerMTok.peak).toBe(m.outputPerMTok.offpeak);
      } else {
        expect(m.outputPerMTok.peak).toBeGreaterThan(m.outputPerMTok.offpeak);
      }
    }
  });

  it("cites a source and an effective date for every entry", () => {
    for (const m of MODELS) {
      expect(m.source.length).toBeGreaterThan(10);
      expect(m.effectiveFrom.length).toBeGreaterThan(0);
    }
  });

  it("prices DeepSeek off-peak at exactly half of peak, as published", () => {
    for (const id of ["deepseek-v4-flash", "deepseek-v4-pro"]) {
      const m = modelById(id);
      expect(m.outputPerMTok.offpeak * 2).toBeCloseTo(m.outputPerMTok.peak, 9);
    }
  });

  it("declares the two published peak windows for banded DeepSeek models", () => {
    for (const id of ["deepseek-v4-flash", "deepseek-v4-pro"]) {
      const m = modelById(id);
      expect(m.peakWindowsUtc).toHaveLength(2);
      expect(m.peakWindowsUtc[0]).toEqual({ startMin: 60, endMin: 240 });
      expect(m.peakWindowsUtc[1]).toEqual({ startMin: 360, endMin: 600 });
    }
  });

  it("exempts the weekend on the live DeepSeek entries, per the 23 Aug amendment", () => {
    for (const id of ["deepseek-v4-flash", "deepseek-v4-pro"]) {
      const m = modelById(id);
      expect(m.peakDaysUtc).toEqual([1, 2, 3, 4, 5]);
      expect(m.peakDaysUtc).not.toContain(0);
      expect(m.peakDaysUtc).not.toContain(6);
    }
  });

  it("keeps the launch-week entry on a seven-day schedule for comparison", () => {
    expect(modelById("deepseek-v4-flash-launch").peakDaysUtc).toHaveLength(7);
  });

  it("gives flat models no peak days at all", () => {
    for (const m of MODELS) {
      if (m.peakWindowsUtc.length === 0) expect(m.peakDaysUtc).toEqual([]);
      else expect(m.peakDaysUtc.length).toBeGreaterThan(0);
    }
  });

  it("uses only valid weekday indices", () => {
    for (const m of MODELS) {
      for (const d of m.peakDaysUtc) {
        expect(Number.isInteger(d)).toBe(true);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(6);
      }
    }
  });

  it("throws on an unknown model or zone", () => {
    expect(() => modelById("nope")).toThrow();
    expect(() => zoneById("nope")).toThrow();
  });

  it("has unique zone ids and plausible offsets", () => {
    expect(new Set(ZONES.map((z) => z.id)).size).toBe(ZONES.length);
    for (const z of ZONES) {
      expect(z.offsetMin).toBeGreaterThanOrEqual(-720);
      expect(z.offsetMin).toBeLessThanOrEqual(840);
    }
  });
});

describe("traffic profiles", () => {
  it("has unique profile ids", () => {
    expect(new Set(PROFILES.map((p) => p.id)).size).toBe(PROFILES.length);
  });

  it("gives every workload exactly 24 non-negative hourly buckets", () => {
    for (const p of PROFILES) {
      for (const w of p.workloads) {
        expect(w.hourlyOutputTokens).toHaveLength(24);
        for (const v of w.hourlyOutputTokens) expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("uses unique workload ids within a profile", () => {
    for (const p of PROFILES) {
      expect(new Set(p.workloads.map((w) => w.id)).size).toBe(p.workloads.length);
    }
  });

  it("gives deferrable workloads a shift window and fixed ones none", () => {
    for (const p of PROFILES) {
      for (const w of p.workloads) {
        if (w.deferrable) expect(w.maxShiftHours).toBeGreaterThan(0);
        else expect(w.maxShiftHours).toBe(0);
      }
    }
  });

  it("ships at least one profile with real deferrable volume to shift", () => {
    const p = profileById("india-saas");
    const deferrable = p.workloads.filter((w) => w.deferrable);
    expect(deferrable.length).toBeGreaterThan(0);
    const total = deferrable.reduce(
      (s, w) => s + w.hourlyOutputTokens.reduce((a, b) => a + b, 0),
      0,
    );
    expect(total).toBeGreaterThan(0);
  });

  it("throws on an unknown profile", () => {
    expect(() => profileById("nope")).toThrow();
  });
});
