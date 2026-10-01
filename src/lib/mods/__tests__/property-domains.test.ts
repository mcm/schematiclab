import { describe, expect, it } from "vitest";

import {
  completeBlockProperties,
  completePropertyValues,
  isVanillaPropertyName,
} from "../property-domains";

describe("completePropertyValues", () => {
  it("completes booleans whatever the property is called", () => {
    expect(completePropertyValues("north", ["true"])).toEqual([
      "true",
      "false",
    ]);
    expect(completePropertyValues("connected_up", ["false"])).toEqual([
      "false",
      "true",
    ]);
  });

  it("widens to the smallest vanilla value set holding every observed value", () => {
    expect(completePropertyValues("facing", ["north"])).toEqual([
      "north",
      "south",
      "west",
      "east",
    ]);
    expect(completePropertyValues("facing", ["east", "up"])).toEqual([
      "east",
      "up",
      "north",
      "south",
      "west",
      "down",
    ]);
    expect(completePropertyValues("type", ["double"])).toEqual([
      "double",
      "top",
      "bottom",
    ]);
  });

  it("leaves values alone when the smallest vanilla set is ambiguous or absent", () => {
    // Walls (`none|low|tall`) and redstone (`up|side|none`) both fit.
    expect(completePropertyValues("north", ["none"])).toEqual(["none"]);
    expect(completePropertyValues("part", ["top"])).toEqual(["top"]);
    expect(completePropertyValues("mode", ["a", "b"])).toEqual(["a", "b"]);
    expect(completePropertyValues("facing", [])).toEqual([]);
  });
});

describe("completeBlockProperties", () => {
  it("completes every property of a block", () => {
    expect(
      completeBlockProperties({ north: ["true"], variant: ["oak"] }),
    ).toEqual({ north: ["true", "false"], variant: ["oak"] });
  });
});

describe("isVanillaPropertyName", () => {
  it("knows vanilla property names", () => {
    expect(isVanillaPropertyName("waterlogged")).toBe(true);
    expect(isVanillaPropertyName("connected_up")).toBe(false);
    expect(isVanillaPropertyName("__proto__")).toBe(false);
  });
});
