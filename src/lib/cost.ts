import { isWeekendDay, peakFractionForLocalHour, peakFractionForLocalHourOnDay } from "./clock";
import type {
  CostReport,
  DayCost,
  HourCost,
  ModelPricing,
  WeekCostReport,
  Workload,
  Zone,
} from "./types";

const PER_M = 1_000_000;

/** Sum several workloads' hourly arrays into one 24-slot array. */
export function combineHourly(
  workloads: Workload[],
  override?: Record<string, number[]>,
): number[] {
  const out = new Array(24).fill(0);
  for (const w of workloads) {
    const series = override?.[w.id] ?? w.hourlyOutputTokens;
    for (let h = 0; h < 24; h++) out[h] += series[h] ?? 0;
  }
  return out;
}

/** Blended USD per 1M tokens for one local hour under a model's bands. */
export function blendedRate(
  localHour: number,
  zone: Zone,
  model: ModelPricing,
): { peakFraction: number; blendedPerMTok: number } {
  const peakFraction = peakFractionForLocalHour(
    localHour,
    zone,
    model.peakWindowsUtc,
  );
  const blendedPerMTok =
    peakFraction * model.outputPerMTok.peak +
    (1 - peakFraction) * model.outputPerMTok.offpeak;
  return { peakFraction, blendedPerMTok };
}

export function costForHourly(
  hourlyTokens: number[],
  zone: Zone,
  model: ModelPricing,
): CostReport {
  const hours: HourCost[] = [];
  let totalTokens = 0;
  let totalCostUsd = 0;
  let peakCostUsd = 0;

  for (let h = 0; h < 24; h++) {
    const tokens = hourlyTokens[h] ?? 0;
    const { peakFraction, blendedPerMTok } = blendedRate(h, zone, model);
    const costUsd = (tokens / PER_M) * blendedPerMTok;

    // The peak-priced share of this hour's spend, for exposure reporting.
    peakCostUsd += (tokens / PER_M) * peakFraction * model.outputPerMTok.peak;

    hours.push({ hour: h, tokens, peakFraction, blendedPerMTok, costUsd });
    totalTokens += tokens;
    totalCostUsd += costUsd;
  }

  const previousFlatCostUsd =
    model.previousFlatOutputPerMTok === null
      ? null
      : (totalTokens / PER_M) * model.previousFlatOutputPerMTok;

  return {
    hours,
    totalTokens,
    totalCostUsd,
    peakExposure: totalCostUsd === 0 ? 0 : peakCostUsd / totalCostUsd,
    previousFlatCostUsd,
  };
}

/** Blended USD per 1M tokens for one local hour on one local day. */
export function blendedRateOnDay(
  localHour: number,
  localDay: number,
  zone: Zone,
  model: ModelPricing,
): { peakFraction: number; blendedPerMTok: number } {
  const peakFraction = peakFractionForLocalHourOnDay(localHour, localDay, zone, model);
  const blendedPerMTok =
    peakFraction * model.outputPerMTok.peak +
    (1 - peakFraction) * model.outputPerMTok.offpeak;
  return { peakFraction, blendedPerMTok };
}

/** Price one local day's hourly traffic, honouring the weekend exemption. */
export function costForHourlyOnDay(
  hourlyTokens: number[],
  localDay: number,
  zone: Zone,
  model: ModelPricing,
): CostReport {
  const hours: HourCost[] = [];
  let totalTokens = 0;
  let totalCostUsd = 0;
  let peakCostUsd = 0;

  for (let h = 0; h < 24; h++) {
    const tokens = hourlyTokens[h] ?? 0;
    const { peakFraction, blendedPerMTok } = blendedRateOnDay(h, localDay, zone, model);
    const costUsd = (tokens / PER_M) * blendedPerMTok;
    peakCostUsd += (tokens / PER_M) * peakFraction * model.outputPerMTok.peak;

    hours.push({ hour: h, tokens, peakFraction, blendedPerMTok, costUsd });
    totalTokens += tokens;
    totalCostUsd += costUsd;
  }

  const previousFlatCostUsd =
    model.previousFlatOutputPerMTok === null
      ? null
      : (totalTokens / PER_M) * model.previousFlatOutputPerMTok;

  return {
    hours,
    totalTokens,
    totalCostUsd,
    peakExposure: totalCostUsd === 0 ? 0 : peakCostUsd / totalCostUsd,
    previousFlatCostUsd,
  };
}

/**
 * Price a full week, one local day at a time.
 *
 * Every one of the seven days is priced separately rather than multiplying a
 * "representative weekday" by five. For zones far from UTC the days genuinely
 * differ: in US Pacific, local Friday evening lands on UTC Saturday and is
 * exempt, while local Sunday evening lands on UTC Monday and is not. A
 * representative day would hide both.
 */
export function costForWeek(
  hourlyTokens: number[],
  zone: Zone,
  model: ModelPricing,
): WeekCostReport {
  const days: DayCost[] = [];
  let weeklyTokens = 0;
  let weeklyCostUsd = 0;
  let weeklyPeakCostUsd = 0;

  for (let day = 0; day < 7; day++) {
    const report = costForHourlyOnDay(hourlyTokens, day, zone, model);
    days.push({ day, report });
    weeklyTokens += report.totalTokens;
    weeklyCostUsd += report.totalCostUsd;
    weeklyPeakCostUsd += report.totalCostUsd * report.peakExposure;
  }

  return {
    days,
    weeklyTokens,
    weeklyCostUsd,
    peakExposure: weeklyCostUsd === 0 ? 0 : weeklyPeakCostUsd / weeklyCostUsd,
    previousFlatWeeklyCostUsd:
      model.previousFlatOutputPerMTok === null
        ? null
        : (weeklyTokens / PER_M) * model.previousFlatOutputPerMTok,
  };
}

/** Cheapest local day of the week for this traffic shape. */
export function cheapestDay(week: WeekCostReport): DayCost {
  return week.days.reduce((best, d) =>
    d.report.totalCostUsd < best.report.totalCostUsd ? d : best,
  );
}

/** Cheapest WEEKEND day — the destination a batch job should aim for. */
export function cheapestWeekendDay(week: WeekCostReport): DayCost {
  const weekend = week.days.filter((d) => isWeekendDay(d.day));
  return weekend.reduce((best, d) =>
    d.report.totalCostUsd < best.report.totalCostUsd ? d : best,
  );
}
