import { describe, it, expect } from "vitest";
import { hourLabel, multiple, pct, tokens, usd } from "../format";

describe("usd", () => {
  it("formats zero plainly", () => expect(usd(0)).toBe("$0.00"));
  it("keeps precision on tiny amounts", () => expect(usd(0.0032)).toBe("$0.0032"));
  it("uses cents in the normal range", () => expect(usd(12.345)).toBe("$12.35"));
  it("rounds and groups large amounts", () => expect(usd(12345.6)).toBe("$12,346"));
});

describe("pct", () => {
  it("renders a fraction as a percentage", () => expect(pct(0.5)).toBe("50.0%"));
  it("honours the digit count", () => expect(pct(0.12345, 2)).toBe("12.35%"));
});

describe("tokens", () => {
  it("scales to K, M and B", () => {
    expect(tokens(500)).toBe("500");
    expect(tokens(12_000)).toBe("12K");
    expect(tokens(3_400_000)).toBe("3.4M");
    expect(tokens(2_100_000_000)).toBe("2.10B");
  });
});

describe("hourLabel", () => {
  it("zero-pads the hour", () => {
    expect(hourLabel(0)).toBe("00:00");
    expect(hourLabel(9)).toBe("09:00");
    expect(hourLabel(23)).toBe("23:00");
  });
});

describe("multiple", () => {
  it("expresses a rate change as a multiple", () => {
    expect(multiple(0.28, 1.32)).toBe("4.7x");
    expect(multiple(0.87, 3.96)).toBe("4.6x");
  });
  it("refuses to divide by zero", () => expect(multiple(0, 5)).toBe("—"));
});
