import { describe, expect, it } from "vitest";

import { clearDiffSearchParams, parseDiffRouteSearch } from "./diffRouteSearch";

describe("parseDiffRouteSearch", () => {
  it("parses valid diff search values", () => {
    const parsed = parseDiffRouteSearch({
      diff: "1",
      diffTurnId: "turn-1",
      diffFilePath: "src/app.ts",
    });

    expect(parsed).toEqual({
      diff: "1",
      diffTurnId: "turn-1",
      diffFilePath: "src/app.ts",
    });
  });

  it("treats numeric and boolean diff toggles as open", () => {
    expect(
      parseDiffRouteSearch({
        diff: 1,
        diffTurnId: "turn-1",
      }),
    ).toEqual({
      diff: "1",
      diffTurnId: "turn-1",
    });

    expect(
      parseDiffRouteSearch({
        diff: true,
        diffTurnId: "turn-1",
      }),
    ).toEqual({
      diff: "1",
      diffTurnId: "turn-1",
    });
  });

  it("drops turn and file values when diff is closed", () => {
    const parsed = parseDiffRouteSearch({
      diff: "0",
      diffTurnId: "turn-1",
      diffFilePath: "src/app.ts",
    });

    expect(parsed).toEqual({});
  });

  it("drops file value when turn is not selected", () => {
    const parsed = parseDiffRouteSearch({
      diff: "1",
      diffFilePath: "src/app.ts",
    });

    expect(parsed).toEqual({
      diff: "1",
    });
  });

  it("normalizes whitespace-only values", () => {
    const parsed = parseDiffRouteSearch({
      diff: "1",
      diffTurnId: "  ",
      diffFilePath: "  ",
    });

    expect(parsed).toEqual({
      diff: "1",
    });
  });

  it("clears diff params with explicit undefined values", () => {
    const cleared = clearDiffSearchParams({
      diff: "1",
      diffTurnId: "turn-1",
      diffFilePath: "src/app.ts",
      filter: "open",
    });

    expect(cleared.filter).toBe("open");
    expect(Object.hasOwn(cleared, "diff")).toBe(true);
    expect(Object.hasOwn(cleared, "diffTurnId")).toBe(true);
    expect(Object.hasOwn(cleared, "diffFilePath")).toBe(true);
    expect(cleared.diff).toBeUndefined();
    expect(cleared.diffTurnId).toBeUndefined();
    expect(cleared.diffFilePath).toBeUndefined();
  });
});
