import { describe, expect, it } from "vitest";

import {
  locateModpackFiles,
  parseMinecraftInstance,
} from "../modpack-instance";

function addon(overrides: Record<string, unknown> = {}) {
  return {
    addonID: 42,
    name: "Create",
    fileNameOnDisk: "create-0.5.1.jar",
    webSiteURL: "https://www.curseforge.com/minecraft/mc-mods/create",
    thumbnailUrl: "https://media.example/create.png",
    categorySection: { path: "mods" },
    isEnabled: true,
    installedFile: {
      id: 100,
      fileName: "create-0.5.1.jar",
      gameVersion: ["NeoForge", "1.21.1", "Client", "1.21"],
    },
    ...overrides,
  };
}

function instance(addons: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    name: "My Pack",
    gameVersion: "1.21.1",
    baseModLoader: { name: "neoforge-21.1.1", type: 6 },
    installedAddons: addons,
    ...overrides,
  };
}

describe("parseMinecraftInstance", () => {
  it("maps installed addons to CurseForge mod files", () => {
    expect(parseMinecraftInstance(instance([addon()]))).toEqual({
      name: "My Pack",
      gameVersion: "1.21.1",
      loader: "neoforge",
      mods: [
        {
          modId: 42,
          fileId: 100,
          name: "Create",
          slug: "create",
          logoUrl: "https://media.example/create.png",
          fileName: "create-0.5.1.jar",
          fileDisplayName: "create-0.5.1.jar",
          gameVersions: ["1.21.1", "1.21"],
          loader: "neoforge",
        },
      ],
    });
  });

  it("skips disabled mods, non-mod addons and entries without ids", () => {
    const parsed = parseMinecraftInstance(
      instance([
        addon({ addonID: 1, fileNameOnDisk: "a.jar.disabled" }),
        addon({ addonID: 2, isEnabled: false }),
        addon({
          addonID: 3,
          fileNameOnDisk: "pack.zip",
          categorySection: { path: "resourcepacks" },
        }),
        addon({ addonID: 4, installedFile: { fileName: "x.jar" } }),
        addon({ addonID: undefined }),
        addon({ addonID: 5, name: "Kept" }),
      ]),
    );
    expect(parsed.mods.map((mod) => mod.modId)).toEqual([5]);
  });

  it("keeps the first file per mod and sorts by name", () => {
    const parsed = parseMinecraftInstance(
      instance([
        addon({ addonID: 2, name: "Zeta" }),
        addon({ addonID: 1, name: "alpha" }),
        addon({ addonID: 2, name: "Zeta duplicate" }),
      ]),
    );
    expect(parsed.mods.map((mod) => mod.name)).toEqual(["alpha", "Zeta"]);
  });

  it("falls back to the loader name and the file's single loader", () => {
    const byName = parseMinecraftInstance(
      instance([addon()], { baseModLoader: { name: "forge-47.2.0" } }),
    );
    expect(byName.loader).toBe("forge");

    const noPackLoader = parseMinecraftInstance(
      instance(
        [
          addon({ addonID: 1, name: "A" }),
          addon({
            addonID: 2,
            name: "B",
            installedFile: { id: 7, gameVersion: ["Fabric", "Quilt"] },
          }),
        ],
        { baseModLoader: null },
      ),
    );
    expect(noPackLoader.loader).toBeNull();
    expect(noPackLoader.mods.map((mod) => mod.loader)).toEqual([
      "neoforge",
      null,
    ]);
  });

  it("rejects JSON that isn't an instance manifest", () => {
    expect(() => parseMinecraftInstance({ files: [] })).toThrow(
      /doesn't list any installed mods/,
    );
    expect(() => parseMinecraftInstance(null)).toThrow();
  });
});

describe("locateModpackFiles", () => {
  const f = (path: string) => ({ path });

  it("finds the manifest and the jars directly in mods/", () => {
    const located = locateModpackFiles([
      f("Pack/minecraftinstance.json"),
      f("Pack/mods/a.jar"),
      f("Pack/mods/b.jar.disabled"),
      f("Pack/mods/sub/c.jar"),
      f("Pack/saves/World/level.dat"),
    ]);
    expect(located?.manifest.path).toBe("Pack/minecraftinstance.json");
    expect([...(located?.jars.keys() ?? [])]).toEqual([
      "a.jar",
      "b.jar.disabled",
    ]);
  });

  it("prefers the shallowest manifest", () => {
    const located = locateModpackFiles([
      f("Instances/Other/backup/minecraftinstance.json"),
      f("Instances/Pack/minecraftinstance.json"),
      f("Instances/Pack/mods/a.jar"),
    ]);
    expect(located?.manifest.path).toBe(
      "Instances/Pack/minecraftinstance.json",
    );
    expect(located?.jars.has("a.jar")).toBe(true);
  });

  it("returns null without a manifest", () => {
    expect(locateModpackFiles([f("mods/a.jar")])).toBeNull();
  });
});
