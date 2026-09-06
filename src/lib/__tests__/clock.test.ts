import { describe, it, expect } from "vitest";
import {
  overlapMinutes,
  peakFractionForLocalHour,
  windowInZone,
  wrapHour,
  wrapMin,
} from "../clock";
import { zoneById } from "../../data/pricing";
import type { UtcWindow } from "../types";

const PEAK: UtcWindow[] = [
  { startMin: 60, endMin: 240 },   // 01:00–04:00 UTC
  { startMin: 360, endMin: 600 },  // 06:00–10:00 UTC
];

describe("wrapping", () => {
  it("normalizes minutes onto a single day", () => {
    expect(wrapMin(0)).toBe(0);
    expect(wrapMin(1440)).toBe(0);
    expect(wrapMin(-30)).toBe(1410);
    expect(wrapMin(1470)).toBe(30);
  });

  it("normalizes hours", () => {
    expect(wrapHour(0)).toBe(0);
    expect(wrapHour(24)).toBe(0);
    expect(wrapHour(-1)).toBe(23);
    expect(wrapHour(25)).toBe(1);
  });
});

describe("overlapMinutes", () => {
  it("returns zero when the interval misses the window", () => {
    expect(overlapMinutes(300, 60, PEAK[0])).toBe(0);
  });

  it("returns the full length when fully contained", () => {
    expect(overlapMinutes(90, 60, PEAK[0])).toBe(60);
  });

  it("returns a partial overlap at the window edge", () => {
    // 00:30–01:30 meets 01:00–04:00 for thirty minutes.
    expect(overlapMinutes(30, 60, PEAK[0])).toBe(30);
  });

  it("handles an interval that wraps past midnight", () => {
    // 23:30–00:30 does not touch a window starting at 01:00.
    expect(overlapMinutes(1410, 60, PEAK[0])).toBe(0);
    // A window that itself wraps midnight is met on the far side.
    const wrapping: UtcWindow = { startMin: 1380, endMin: 60 }; // 23:00–01:00
    expect(overlapMinutes(1410, 60, wrapping)).toBe(60);
  });

  it("ignores non-positive lengths", () => {
    expect(overlapMinutes(90, 0, PEAK[0])).toBe(0);
  });
});

describe("peakFractionForLocalHour", () => {
  it("is zero for a model with no time-of-day bands", () => {
    expect(peakFractionForLocalHour(12, zoneById("utc"), [])).toBe(0);
  });

  it("aligns exactly in UTC", () => {
    const utc = zoneById("utc");
    expect(peakFractionForLocalHour(0, utc, PEAK)).toBe(0);
    expect(peakFractionForLocalHour(1, utc, PEAK)).toBe(1);
    expect(peakFractionForLocalHour(3, utc, PEAK)).toBe(1);
    expect(peakFractionForLocalHour(4, utc, PEAK)).toBe(0);
    expect(peakFractionForLocalHour(6, utc, PEAK)).toBe(1);
    expect(peakFractionForLocalHour(9, utc, PEAK)).toBe(1);
    expect(peakFractionForLocalHour(10, utc, PEAK)).toBe(0);
  });

  it("reproduces the published Beijing working-day windows", () => {
    const cst = zoneById("cst"); // UTC+8
    // 09:00–12:00 and 14:00–18:00 local.
    for (const h of [9, 10, 11, 14, 15, 16, 17]) {
      expect(peakFractionForLocalHour(h, cst, PEAK)).toBe(1);
    }
    for (const h of [8, 12, 13, 18, 0, 23]) {
      expect(peakFractionForLocalHour(h, cst, PEAK)).toBe(0);
    }
  });

  it("splits a local hour when the zone offset is not a whole hour", () => {
    const ist = zoneById("ist"); // UTC+5:30
    // 06:00–07:00 IST is 00:30–01:30 UTC: half of it is peak.
    expect(peakFractionForLocalHour(6, ist, PEAK)).toBe(0.5);
    expect(peakFractionForLocalHour(7, ist, PEAK)).toBe(1);
    expect(peakFractionForLocalHour(8, ist, PEAK)).toBe(1);
    expect(peakFractionForLocalHour(9, ist, PEAK)).toBe(0.5);
    expect(peakFractionForLocalHour(10, ist, PEAK)).toBe(0);
    expect(peakFractionForLocalHour(11, ist, PEAK)).toBe(0.5);
    expect(peakFractionForLocalHour(15, ist, PEAK)).toBe(0.5);
    expect(peakFractionForLocalHour(16, ist, PEAK)).toBe(0);
  });

  it("puts the core Indian working hours fully inside a peak window", () => {
    const ist = zoneById("ist");
    for (const h of [12, 13, 14]) {
      expect(peakFractionForLocalHour(h, ist, PEAK)).toBe(1);
    }
  });

  it("leaves the US Pacific working day almost entirely off-peak", () => {
    const pt = zoneById("pt"); // UTC-7
    for (const h of [9, 10, 11, 12, 13, 14, 15, 16, 17]) {
      expect(peakFractionForLocalHour(h, pt, PEAK)).toBe(0);
    }
  });

  it("always returns a fraction in [0, 1]", () => {
    for (const zid of ["ist", "utc", "cst", "cet", "et", "pt"]) {
      for (let h = 0; h < 24; h++) {
        const f = peakFractionForLocalHour(h, zoneById(zid), PEAK);
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThanOrEqual(1);
      }
    }
  });

  it("conserves total peak minutes across a day in every zone", () => {
    // The two windows total seven hours; a day's worth of local hours must
    // account for exactly seven hours of peak, whatever the offset.
    for (const zid of ["ist", "utc", "cst", "cet", "et", "pt"]) {
      let total = 0;
      for (let h = 0; h < 24; h++) {
        total += peakFractionForLocalHour(h, zoneById(zid), PEAK);
      }
      expect(total).toBeCloseTo(7, 9);
    }
  });
});

describe("windowInZone", () => {
  it("renders the peak windows in local time", () => {
    expect(windowInZone(PEAK[0], zoneById("utc"))).toBe("01:00–04:00");
    expect(windowInZone(PEAK[0], zoneById("cst"))).toBe("09:00–12:00");
    expect(windowInZone(PEAK[1], zoneById("cst"))).toBe("14:00–18:00");
    expect(windowInZone(PEAK[0], zoneById("ist"))).toBe("06:30–09:30");
    expect(windowInZone(PEAK[1], zoneById("ist"))).toBe("11:30–15:30");
  });
});
