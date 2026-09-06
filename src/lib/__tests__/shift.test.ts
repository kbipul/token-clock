import { describe, it, expect } from "vitest";
import { cyclicDistance, shiftDeferrable } from "../shift";
import { combineHourly, costForHourly } from "../cost";
import { modelById, zoneById } from "../../data/pricing";
import { profileById } from "../../data/profiles";
import type { Workload } from "../types";

const flash = modelById("deepseek-v4-flash");
const flat = modelById("deepseek-v4-flash-old");
const ist = zoneById("ist");
const utc = zoneById("utc");

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

const wl = (over: Partial<Workload>): Workload => ({
  id: "w",
  name: "w",
  deferrable: true,
  maxShiftHours: 6,
  hourlyOutputTokens: new Array(24).fill(0),
  ...over,
});

describe("cyclicDistance", () => {
  it("measures the shorter way round the clock", () => {
    expect(cyclicDistance(1, 3)).toBe(2);
    expect(cyclicDistance(23, 1)).toBe(2);
    expect(cyclicDistance(0, 12)).toBe(12);
    expect(cyclicDistance(5, 5)).toBe(0);
  });
});

describe("shiftDeferrable", () => {
  it("never touches non-deferrable work", () => {
    const w = wl({
      id: "fixed",
      deferrable: false,
      hourlyOutputTokens: (() => {
        const a = new Array(24).fill(0);
        a[2] = 10_000_000; // an expensive UTC hour
        return a;
      })(),
    });
    const r = shiftDeferrable([w], utc, flash);
    expect(r.shifted.fixed[2]).toBe(10_000_000);
    expect(r.moves).toHaveLength(0);
  });

  it("respects a zero shift window even when deferrable", () => {
    const a = new Array(24).fill(0);
    a[2] = 5_000_000;
    const r = shiftDeferrable(
      [wl({ id: "x", maxShiftHours: 0, hourlyOutputTokens: a })],
      utc,
      flash,
    );
    expect(r.moves).toHaveLength(0);
    expect(r.shifted.x[2]).toBe(5_000_000);
  });

  it("moves work out of a peak hour into a cheaper reachable one", () => {
    const a = new Array(24).fill(0);
    a[2] = 5_000_000; // peak in UTC
    const r = shiftDeferrable(
      [wl({ id: "x", maxShiftHours: 4, hourlyOutputTokens: a })],
      utc,
      flash,
    );
    expect(r.moves.length).toBeGreaterThan(0);
    expect(r.shifted.x[2]).toBeLessThan(5_000_000);
    // Everything it moved landed in an off-peak hour.
    for (const m of r.moves) {
      expect([0, 4, 5]).toContain(m.toHour);
    }
  });

  it("conserves tokens exactly", () => {
    const p = profileById("india-saas");
    const r = shiftDeferrable(p.workloads, ist, flash);
    for (const w of p.workloads) {
      expect(sum(r.shifted[w.id])).toBe(sum(w.hourlyOutputTokens));
    }
  });

  it("never moves work further than its SLA allows", () => {
    const p = profileById("india-saas");
    const r = shiftDeferrable(p.workloads, ist, flash);
    const byId = Object.fromEntries(p.workloads.map((w) => [w.id, w]));
    for (const m of r.moves) {
      expect(cyclicDistance(m.fromHour, m.toHour)).toBeLessThanOrEqual(
        byId[m.workloadId].maxShiftHours,
      );
    }
  });

  it("only ever moves work to a strictly cheaper hour", () => {
    const p = profileById("india-saas");
    const r = shiftDeferrable(p.workloads, ist, flash);
    expect(r.moves.length).toBeGreaterThan(0);
    for (const m of r.moves) expect(m.savedUsd).toBeGreaterThan(0);
  });

  it("respects the per-hour capacity ceiling", () => {
    const a = new Array(24).fill(0);
    a[2] = 12_000_000;
    const r = shiftDeferrable(
      [wl({ id: "x", maxShiftHours: 8, hourlyOutputTokens: a })],
      utc,
      flash,
      1.5,
    );
    const cap = Math.ceil(12_000_000 * 1.5);
    for (const v of r.shifted.x) expect(v).toBeLessThanOrEqual(cap);
  });

  it("actually reduces the bill on a real profile", () => {
    const p = profileById("india-saas");
    const before = costForHourly(combineHourly(p.workloads), ist, flash);
    const r = shiftDeferrable(p.workloads, ist, flash);
    const after = costForHourly(
      combineHourly(p.workloads, r.shifted),
      ist,
      flash,
    );
    expect(after.totalCostUsd).toBeLessThan(before.totalCostUsd);
    expect(after.peakExposure).toBeLessThan(before.peakExposure);
  });

  it("reports savings that match the measured cost difference", () => {
    const p = profileById("india-saas");
    const before = costForHourly(combineHourly(p.workloads), ist, flash);
    const r = shiftDeferrable(p.workloads, ist, flash);
    const after = costForHourly(
      combineHourly(p.workloads, r.shifted),
      ist,
      flash,
    );
    const claimed = r.moves.reduce((s, m) => s + m.savedUsd, 0);
    expect(claimed).toBeCloseTo(before.totalCostUsd - after.totalCostUsd, 6);
  });

  it("finds nothing to do under flat pricing", () => {
    const p = profileById("batch");
    const r = shiftDeferrable(p.workloads, ist, flat);
    expect(r.moves).toHaveLength(0);
  });

  it("is deterministic", () => {
    const p = profileById("india-saas");
    const a = shiftDeferrable(p.workloads, ist, flash);
    const b = shiftDeferrable(p.workloads, ist, flash);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("strands work when every cheaper reachable hour is already full", () => {
    // Four consecutive peak hours all wanting to escape through the same two
    // off-peak neighbours, with a tight burst ceiling. Some of it cannot get
    // out, and the result says so instead of quietly banking the saving.
    const a = new Array(24).fill(0);
    a[6] = a[7] = a[8] = a[9] = 100_000_000; // 06:00-10:00 UTC is peak
    const r = shiftDeferrable(
      [wl({ id: "x", maxShiftHours: 2, hourlyOutputTokens: a })],
      utc,
      flash,
      1.1,
    );
    expect(r.strandedTokens).toBeGreaterThan(0);
    // Whatever is stranded is still counted in the day's tokens.
    expect(sum(r.shifted.x)).toBe(400_000_000);
  });

  it("does not call work stranded when it simply had nowhere cheaper to go", () => {
    // A single peak hour whose only reachable neighbours are also peak. There
    // is no saving available, but nothing is being blocked by capacity either,
    // so the stranded count stays at zero.
    const a = new Array(24).fill(0);
    a[2] = 10_000_000; // 01:00-04:00 UTC peak; +/-1h is still peak
    const r = shiftDeferrable(
      [wl({ id: "x", maxShiftHours: 1, hourlyOutputTokens: a })],
      utc,
      flash,
    );
    expect(r.moves).toHaveLength(0);
    expect(r.strandedTokens).toBe(0);
    expect(r.shifted.x[2]).toBe(10_000_000);
  });

  it("leaves nothing stranded when there is ample room", () => {
    const a = new Array(24).fill(0);
    a[2] = 1_000_000;
    const r = shiftDeferrable(
      [wl({ id: "x", maxShiftHours: 6, hourlyOutputTokens: a })],
      utc,
      flash,
      5,
    );
    expect(r.strandedTokens).toBe(0);
  });
});
