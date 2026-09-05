import { costForHourlyOnDay, costForWeek, cheapestWeekendDay } from "./cost";
import { blendedRate } from "./cost";
import { isWeekendDay } from "./clock";
import type {
  ModelPricing,
  ShiftMove,
  ShiftResult,
  WeekendMove,
  WeekendPlan,
  Workload,
  Zone,
} from "./types";

const PER_M = 1_000_000;

/** Shortest distance between two hours on a cyclic 24-hour clock. */
export function cyclicDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 24;
  return Math.min(d, 24 - d);
}

/**
 * Move deferrable load out of expensive hours into cheaper ones.
 *
 * Rules, in order of importance:
 *  - Non-deferrable workloads are never touched. Interactive traffic happens
 *    when your users are awake; pretending otherwise is how a savings number
 *    becomes a lie.
 *  - A workload may only move within +/- maxShiftHours of its original hour.
 *  - No destination hour may exceed `capacityMultiplier` times that workload's
 *    original busiest hour. Real infrastructure cannot absorb a whole day of
 *    batch work in one 3 a.m. slot.
 *  - Work only moves to a STRICTLY cheaper hour. Equal-rate churn is not a win.
 *
 * Deterministic: sources are processed by descending rate then ascending hour,
 * destinations by ascending rate, then distance, then hour.
 */
export function shiftDeferrable(
  workloads: Workload[],
  zone: Zone,
  model: ModelPricing,
  capacityMultiplier = 2,
): ShiftResult {
  const rates = Array.from({ length: 24 }, (_, h) => blendedRate(h, zone, model).blendedPerMTok);
  const shifted: Record<string, number[]> = {};
  const moves: ShiftMove[] = [];
  let strandedTokens = 0;

  for (const w of workloads) {
    const series = [...w.hourlyOutputTokens];
    shifted[w.id] = series;
    if (!w.deferrable || w.maxShiftHours <= 0) continue;

    const cap = Math.ceil(Math.max(...w.hourlyOutputTokens) * capacityMultiplier);

    const sources = Array.from({ length: 24 }, (_, h) => h).sort(
      (a, b) => rates[b] - rates[a] || a - b,
    );

    for (const from of sources) {
      if (series[from] <= 0) continue;

      const destinations = Array.from({ length: 24 }, (_, h) => h)
        .filter(
          (to) =>
            to !== from &&
            cyclicDistance(from, to) <= w.maxShiftHours &&
            rates[to] < rates[from],
        )
        .sort(
          (a, b) =>
            rates[a] - rates[b] ||
            cyclicDistance(from, a) - cyclicDistance(from, b) ||
            a - b,
        );

      if (destinations.length === 0) continue;

      for (const to of destinations) {
        if (series[from] <= 0) break;
        const room = cap - series[to];
        if (room <= 0) continue;
        const tokens = Math.min(series[from], room);
        if (tokens <= 0) continue;

        series[from] -= tokens;
        series[to] += tokens;
        moves.push({
          workloadId: w.id,
          fromHour: from,
          toHour: to,
          tokens,
          savedUsd: (tokens / PER_M) * (rates[from] - rates[to]),
        });
      }

      // Anything still sitting here that had somewhere cheaper to go, but found
      // every cheaper hour full, is genuinely stranded — report it rather than
      // quietly folding it into the savings headline.
      if (series[from] > 0) strandedTokens += series[from];
    }
  }

  return { shifted, moves, strandedTokens };
}

/**
 * The weekend play.
 *
 * Since 23 Aug 2026 DeepSeek bills Saturday and Sunday entirely at the off-peak
 * rate, which makes the cheapest lever no longer "run this batch at 3 a.m." but
 * "run it on Saturday". For every deferrable workload this compares the cost of
 * its weekday run against the same run on the cheapest weekend day.
 *
 * Deliberately NOT netted against a capacity model: moving all five weekday runs
 * onto two days is a scheduling decision only the owner can make, so each
 * weekday is reported as its own move and the total is clearly the ceiling.
 */
export function weekendPlan(
  workloads: Workload[],
  zone: Zone,
  model: ModelPricing,
): WeekendPlan {
  const deferrable = workloads.filter((w) => w.deferrable);
  const moves: WeekendMove[] = [];
  let baselineDeferrableUsd = 0;

  for (const w of deferrable) {
    const week = costForWeek(w.hourlyOutputTokens, zone, model);
    baselineDeferrableUsd += week.weeklyCostUsd;

    const target = cheapestWeekendDay(week);
    const weekendCostUsd = target.report.totalCostUsd;

    for (const { day, report } of week.days) {
      if (isWeekendDay(day)) continue;
      const savedUsd = report.totalCostUsd - weekendCostUsd;
      if (savedUsd <= 1e-12) continue;
      moves.push({
        workloadId: w.id,
        workloadName: w.name,
        fromDay: day,
        toDay: target.day,
        tokens: report.totalTokens,
        weekdayCostUsd: report.totalCostUsd,
        weekendCostUsd,
        savedUsd,
      });
    }
  }

  const totalSavedUsd = moves.reduce((s, m) => s + m.savedUsd, 0);
  return {
    moves,
    totalSavedUsd,
    baselineDeferrableUsd,
    noWeekendEdge: moves.length === 0,
  };
}

/**
 * Weekly cost after BOTH levers: intra-day shifting on the five weekdays, and
 * the untouched (already all-off-peak) weekend days.
 */
export function weeklyCostAfterIntradayShift(
  workloads: Workload[],
  shiftedSeries: Record<string, number[]>,
  zone: Zone,
  model: ModelPricing,
): number {
  const combined = new Array(24).fill(0);
  for (const w of workloads) {
    const series = shiftedSeries[w.id] ?? w.hourlyOutputTokens;
    for (let h = 0; h < 24; h++) combined[h] += series[h] ?? 0;
  }
  let total = 0;
  for (let day = 0; day < 7; day++) {
    total += costForHourlyOnDay(combined, day, zone, model).totalCostUsd;
  }
  return total;
}
