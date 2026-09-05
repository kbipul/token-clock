import { describe, it, expect } from "vitest";
import {
  isPeakDayUtc,
  isWeekendDay,
  peakFractionForLocalHour,
  peakFractionForLocalHourOnDay,
  wrapWeekMin,
  MINUTES_PER_WEEK,
} from "../clock";
import { cheapestWeekendDay, costForHourlyOnDay, costForWeek } from "../cost";
import { weekendPlan, weeklyCostAfterIntradayShift } from "../shift";
import { modelById, zoneById } from "../../data/pricing";
import type { UtcWindow, Workload } from "../types";

const PEAK: UtcWindow[] = [
  { startMin: 60, endMin: 240 }, // 01:00–04:00 UTC
  { startMin: 360, endMin: 600 }, // 06:00–10:00 UTC
];
const WEEKDAYS = [1, 2, 3, 4, 5];
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

const utc = zoneById("utc");
const ist = zoneById("ist");
const pt = zoneById("pt");

const flat = (n: number) => new Array(24).fill(n);

describe("week wrapping", () => {
  it("normalizes minutes onto a single week", () => {
    expect(wrapWeekMin(0)).toBe(0);
    expect(wrapWeekMin(MINUTES_PER_WEEK)).toBe(0);
    expect(wrapWeekMin(-1)).toBe(MINUTES_PER_WEEK - 1);
    expect(wrapWeekMin(MINUTES_PER_WEEK + 5)).toBe(5);
  });

  it("identifies peak days and weekend days", () => {
    expect(isPeakDayUtc(1, WEEKDAYS)).toBe(true);
    expect(isPeakDayUtc(6, WEEKDAYS)).toBe(false);
    expect(isPeakDayUtc(0, WEEKDAYS)).toBe(false);
    expect(isPeakDayUtc(-1, WEEKDAYS)).toBe(false); // -1 wraps to Saturday
    expect(isWeekendDay(0)).toBe(true);
    expect(isWeekendDay(6)).toBe(true);
    expect(isWeekendDay(3)).toBe(false);
  });
});

describe("peakFractionForLocalHourOnDay", () => {
  const bands = { peakWindowsUtc: PEAK, peakDaysUtc: WEEKDAYS };

  it("charges peak inside a window on a weekday", () => {
    expect(peakFractionForLocalHourOnDay(2, 3, utc, bands)).toBe(1);
    expect(peakFractionForLocalHourOnDay(7, 3, utc, bands)).toBe(1);
  });

  it("charges nothing at the same hour on Saturday or Sunday", () => {
    expect(peakFractionForLocalHourOnDay(2, 6, utc, bands)).toBe(0);
    expect(peakFractionForLocalHourOnDay(7, 0, utc, bands)).toBe(0);
  });

  it("still charges nothing outside the windows on a weekday", () => {
    expect(peakFractionForLocalHourOnDay(12, 3, utc, bands)).toBe(0);
  });

  it("agrees with the day-agnostic function on a peak day", () => {
    for (let h = 0; h < 24; h++) {
      expect(peakFractionForLocalHourOnDay(h, 3, ist, bands)).toBeCloseTo(
        peakFractionForLocalHour(h, ist, PEAK),
        9,
      );
    }
  });

  it("resolves the weekend on the UTC day, not the local day", () => {
    // US Pacific is UTC-7: local Friday 18:00 is Saturday 01:00 UTC, which is
    // inside a peak window but on an exempt UTC day.
    expect(peakFractionForLocalHourOnDay(18, 5, pt, bands)).toBe(0);
    // Under the launch-week scheme that same hour WAS peak-priced.
    expect(
      peakFractionForLocalHourOnDay(18, 5, pt, {
        peakWindowsUtc: PEAK,
        peakDaysUtc: EVERY_DAY,
      }),
    ).toBe(1);
    // And local Sunday 18:00 PT is Monday 01:00 UTC — a peak day after all.
    expect(peakFractionForLocalHourOnDay(18, 0, pt, bands)).toBe(1);
  });

  it("keeps the IST half-hour straddle correct on a weekday", () => {
    // 06:00-07:00 IST is 00:30-01:30 UTC; half of it is inside the window.
    expect(peakFractionForLocalHourOnDay(6, 3, ist, bands)).toBeCloseTo(0.5, 9);
    // ...and none of it on Sunday.
    expect(peakFractionForLocalHourOnDay(6, 0, ist, bands)).toBe(0);
  });

  it("returns zero when there are no windows or no peak days", () => {
    expect(
      peakFractionForLocalHourOnDay(2, 3, utc, { peakWindowsUtc: [], peakDaysUtc: WEEKDAYS }),
    ).toBe(0);
    expect(
      peakFractionForLocalHourOnDay(2, 3, utc, { peakWindowsUtc: PEAK, peakDaysUtc: [] }),
    ).toBe(0);
  });
});

describe("weekly costing", () => {
  const model = modelById("deepseek-v4-flash");

  it("prices a weekend day strictly below an identical weekday", () => {
    const wed = costForHourlyOnDay(flat(1_000_000), 3, utc, model);
    const sat = costForHourlyOnDay(flat(1_000_000), 6, utc, model);
    expect(sat.totalCostUsd).toBeLessThan(wed.totalCostUsd);
    expect(sat.peakExposure).toBe(0);
    expect(wed.peakExposure).toBeGreaterThan(0);
  });

  it("bills every weekend hour at exactly the off-peak rate", () => {
    const sat = costForHourlyOnDay(flat(1_000_000), 6, utc, model);
    for (const h of sat.hours) {
      expect(h.blendedPerMTok).toBeCloseTo(model.outputPerMTok.offpeak, 9);
    }
  });

  it("sums seven days and keeps the token total consistent", () => {
    const week = costForWeek(flat(1_000_000), utc, model);
    expect(week.days).toHaveLength(7);
    expect(week.weeklyTokens).toBe(24_000_000 * 7);
    const summed = week.days.reduce((s, d) => s + d.report.totalCostUsd, 0);
    expect(week.weeklyCostUsd).toBeCloseTo(summed, 9);
  });

  it("costs less per week than the launch-week seven-day scheme", () => {
    const now = costForWeek(flat(1_000_000), utc, model);
    const launch = costForWeek(flat(1_000_000), utc, modelById("deepseek-v4-flash-launch"));
    expect(now.weeklyCostUsd).toBeLessThan(launch.weeklyCostUsd);
  });

  it("picks a weekend day as the cheapest weekend destination", () => {
    const week = costForWeek(flat(1_000_000), utc, model);
    expect(isWeekendDay(cheapestWeekendDay(week).day)).toBe(true);
  });

  it("prices a flat model identically on every day", () => {
    const week = costForWeek(flat(1_000_000), utc, modelById("deepseek-v4-flash-old"));
    const costs = week.days.map((d) => d.report.totalCostUsd);
    for (const c of costs) expect(c).toBeCloseTo(costs[0], 9);
    expect(week.peakExposure).toBe(0);
  });
});

describe("weekendPlan", () => {
  const model = modelById("deepseek-v4-flash");

  const batch: Workload = {
    id: "batch",
    name: "Nightly re-embedding",
    hourlyOutputTokens: flat(1_000_000),
    deferrable: true,
    maxShiftHours: 6,
  };
  const live: Workload = {
    id: "live",
    name: "Chat",
    hourlyOutputTokens: flat(1_000_000),
    deferrable: false,
    maxShiftHours: 0,
  };

  it("proposes one move per weekday for a deferrable workload", () => {
    const plan = weekendPlan([batch], utc, model);
    expect(plan.moves).toHaveLength(5);
    for (const m of plan.moves) {
      expect(isWeekendDay(m.fromDay)).toBe(false);
      expect(isWeekendDay(m.toDay)).toBe(true);
      expect(m.savedUsd).toBeGreaterThan(0);
      expect(m.weekendCostUsd).toBeLessThan(m.weekdayCostUsd);
    }
    expect(plan.totalSavedUsd).toBeCloseTo(
      plan.moves.reduce((s, m) => s + m.savedUsd, 0),
      9,
    );
    expect(plan.noWeekendEdge).toBe(false);
  });

  it("never moves non-deferrable traffic", () => {
    const plan = weekendPlan([live], utc, model);
    expect(plan.moves).toHaveLength(0);
    expect(plan.noWeekendEdge).toBe(true);
    expect(plan.totalSavedUsd).toBe(0);
  });

  it("finds no edge on a flat-rate model", () => {
    const plan = weekendPlan([batch], utc, modelById("deepseek-v4-flash-old"));
    expect(plan.noWeekendEdge).toBe(true);
  });

  it("never claims to save more than the deferrable spend", () => {
    const plan = weekendPlan([batch, live], ist, model);
    expect(plan.totalSavedUsd).toBeLessThan(plan.baselineDeferrableUsd);
  });

  it("beats intra-day shifting on flat round-the-clock batch traffic", () => {
    const workloads = [batch];
    const baseline = costForWeek(flat(1_000_000), utc, model).weeklyCostUsd;
    const intraday =
      baseline - weeklyCostAfterIntradayShift(workloads, {}, utc, model);
    const plan = weekendPlan(workloads, utc, model);
    expect(plan.totalSavedUsd).toBeGreaterThan(intraday);
  });
});
