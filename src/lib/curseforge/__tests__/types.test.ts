import { describe, expect, it } from "vitest";

import { splitGameVersionTags } from "../types";

describe("splitGameVersionTags", () => {
  it("separates Minecraft versions from loaders and drops other tags", () => {
    expect(
      splitGameVersionTags([
        "NeoForge",
        "1.21.1",
        "Client",
        "forge",
        "1.21-Snapshot",
        "NeoForge",
        "Java 21",
        42,
      ]),
    ).toEqual({
      gameVersions: ["1.21.1", "1.21-Snapshot"],
      loaders: ["neoforge", "forge"],
    });
  });

  it("ignores tags that name Object.prototype members", () => {
    expect(
      splitGameVersionTags(["constructor", "toString", "__proto__"]),
    ).toEqual({ gameVersions: [], loaders: [] });
  });
});
