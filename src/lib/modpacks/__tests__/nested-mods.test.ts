import { readFileSync } from "node:fs";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { vanillaDescriptorSources } from "../appearance";
import { encodeRgbaPng } from "../png";
import {
  extractModpack,
  type ModpackModSource,
  type ModpackSource,
} from "../extract";
import { chooseNestedJars, compareMavenVersions } from "../nested-mods";
import { modpackDataSchema } from "../schema";

// Vanilla models only (cube_all), so mod textures make swatches.
const vanilla = vanillaDescriptorSources({
  models: JSON.parse(
    readFileSync(
      path.join(process.cwd(), "public", "minecraft-assets", "models.json"),
      "utf8",
    ),
  ) as Record<string, unknown>,
  atlas: { width: 1, height: 1, data: new Uint8Array(4) },
  uvs: {},
});

const NOW = () => new Date("2026-10-06T12:00:00.000Z");
const json = (value: unknown) => strToU8(JSON.stringify(value));

function solidPng(rgba: [number, number, number, number]): Uint8Array {
  const data = new Uint8Array(16 * 16 * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return encodeRgbaPng(16, 16, data);
}

const modsToml = (...ids: string[]) =>
  strToU8(
    `modLoader="javafml"\nloaderVersion="[1,)"\n${ids
      .map((id) => `[[mods]]\nmodId="${id}"\nversion="1"\n`)
      .join("")}`,
  );

/** A self-contained cube block: blockstate, model and texture. */
function cube(id: string): Record<string, Uint8Array> {
  const [ns, path] = id.split(":");
  return {
    [`assets/${ns}/blockstates/${path}.json`]: json({
      variants: { "": { model: `${ns}:block/${path}` } },
    }),
    [`assets/${ns}/models/block/${path}.json`]: json({
      parent: "minecraft:block/cube_all",
      textures: { all: `${ns}:block/${path}` },
    }),
    [`assets/${ns}/textures/block/${path}.png`]: solidPng([200, 40, 40, 255]),
  };
}

interface Nested {
  file: string;
  group?: string;
  artifact?: string;
  version?: string;
  modIds: string[];
  blocks: string[];
}

/** A mod jar with its own blocks and jars nested in `META-INF/jarjar/`. */
function jar(modIds: string[], blocks: string[], nested: Nested[] = []) {
  const files: Record<string, Uint8Array> = {};
  if (modIds.length > 0)
    files["META-INF/neoforge.mods.toml"] = modsToml(...modIds);
  for (const id of blocks) Object.assign(files, cube(id));
  const listed = nested.filter((n) => n.artifact !== undefined);
  if (listed.length > 0) {
    files["META-INF/jarjar/metadata.json"] = json({
      jars: listed.map((n) => ({
        identifier: { group: n.group, artifact: n.artifact },
        version: { range: `[${n.version},)`, artifactVersion: n.version },
        path: `META-INF/jarjar/${n.file}`,
      })),
    });
  }
  for (const n of nested) {
    const inner: Record<string, Uint8Array> = {};
    if (n.modIds.length > 0) {
      inner["META-INF/neoforge.mods.toml"] = modsToml(...n.modIds);
    }
    for (const id of n.blocks) Object.assign(inner, cube(id));
    files[`META-INF/jarjar/${n.file}`] = zipSync(inner);
  }
  return zipSync(files);
}

function mod(
  name: string,
  fileId: number,
  bytes: Uint8Array,
): ModpackModSource {
  return {
    name,
    fileName: `${name.toLowerCase().replace(/\s+/g, "-")}.jar`,
    curseForgeProjectId: fileId,
    curseForgeFileId: fileId,
    size: bytes.length,
    read: async () => bytes,
  };
}

function pack(mods: ModpackModSource[]): ModpackSource {
  return {
    name: "Nested",
    displayVersion: "1.0",
    minecraftVersion: "1.21.1",
    loader: "neoforge",
    curseForgeProjectId: null,
    packFileId: null,
    hasKubeJs: false,
    warnings: [],
    mods,
  };
}

const sauce = (version: string, blocks: string[]): Nested => ({
  file: `sauce-${version}.jar`,
  group: "com.hollingsworth",
  artifact: "sauce",
  version,
  modIds: ["sauce"],
  blocks,
});

describe("compareMavenVersions", () => {
  it("orders numeric segments numerically, then qualifiers", () => {
    const sorted = [
      "1.10",
      "1.2",
      "1.10-beta",
      "1.10-rc1",
      "1.10-alpha",
      "1.9.9",
      "1.10-SNAPSHOT",
      "1.10.1",
    ].sort((a, b) => compareMavenVersions(a, b));
    expect(sorted).toEqual([
      "1.2",
      "1.9.9",
      "1.10-alpha",
      "1.10-beta",
      "1.10-rc1",
      "1.10-SNAPSHOT",
      "1.10",
      "1.10.1",
    ]);
    expect(compareMavenVersions("1.0", "1")).toBe(0);
    expect(compareMavenVersions("1.0-rc", "1-rc")).toBe(0);
    expect(compareMavenVersions("1.0.0-final", "1")).toBe(0);
    expect(compareMavenVersions("1-sp", "1")).toBe(1);
    expect(compareMavenVersions(null, "0.1")).toBe(-1);
    expect(compareMavenVersions(null, null)).toBe(0);
  });
});

describe("chooseNestedJars", () => {
  const index = (modIds: string[], nested: Partial<Nested>[]) => ({
    modIds,
    nestedJars: nested.map((n) => ({
      path: `META-INF/jarjar/${n.file ?? "x.jar"}`,
      group: n.group ?? null,
      artifact: n.artifact ?? null,
      version: n.version ?? null,
      modIds: n.modIds ?? [],
      depth: 1,
    })),
  });

  it("groups by mod id when the metadata doesn't list a jar", () => {
    const decisions = chooseNestedJars([
      { outer: "a.jar", index: index(["a"], [{ modIds: ["lib"] }]) },
      { outer: "broken.jar", index: null },
      {
        outer: "b.jar",
        index: index(["b"], [{ modIds: ["lib"] }, { file: "plain.jar" }]),
      },
    ]);
    expect(decisions.map((d) => [d.outer, d.kept, d.reason])).toEqual([
      ["a.jar", true, undefined],
      ["b.jar", false, "the same version is read from a.jar"],
      // Neither coordinates nor a mod id: nothing to compare it with.
      ["b.jar", true, undefined],
    ]);
    expect(decisions[1].owner).toBe(2);
  });
});

describe("nested mods across a pack", () => {
  it("reads only the highest version of a library nested in three jars", async () => {
    const { data, warnings, swatches, nestedJars } = await extractModpack(
      pack([
        mod(
          "Ars A",
          1,
          jar(["ars_a"], ["ars_a:altar"], [sauce("1.2", ["sauce:pan"])]),
        ),
        mod(
          "Ars B",
          2,
          jar([], [], [sauce("1.10", ["sauce:pan", "sauce:pot"])]),
        ),
        mod(
          "Ars C",
          3,
          jar(["ars_c"], ["ars_c:loom"], [sauce("1.10-beta", ["sauce:pan"])]),
        ),
      ]),
      { vanilla, now: NOW },
    );
    expect(modpackDataSchema.safeParse(data).success).toBe(true);
    expect(data.blocks.map((b) => [b.id, b.mod])).toEqual([
      ["ars_a:altar", "cf-1"],
      ["ars_c:loom", "cf-3"],
      ["sauce:pan", "cf-2"],
      ["sauce:pot", "cf-2"],
    ]);
    expect(data.blocks.find((b) => b.id === "sauce:pot")?.swatch?.file).toBe(
      "cf-2",
    );
    expect(warnings.filter((w) => /is in both/.test(w))).toEqual([]);
    expect(data.mods.map((m) => [m.name, m.status, m.namespaces])).toEqual([
      ["Ars A", "ok", ["ars_a"]],
      ["Ars B", "ok", ["sauce"]],
      ["Ars C", "ok", ["ars_c"]],
    ]);
    expect([...swatches.keys()]).toEqual(["cf-1", "cf-2", "cf-3"]);
    expect(
      nestedJars.map((j) => [j.outer, j.version, j.kept, j.reason]),
    ).toEqual([
      ["ars-a.jar", "1.2", false, "sauce 1.10 is read from ars-b.jar"],
      ["ars-b.jar", "1.10", true, undefined],
      ["ars-c.jar", "1.10-beta", false, "sauce 1.10 is read from ars-b.jar"],
    ]);
  });

  it("skips a nested mod that is also a top-level jar", async () => {
    const { data, warnings, nestedJars } = await extractModpack(
      pack([
        mod(
          "Addon",
          1,
          jar(
            ["addon"],
            ["addon:panel"],
            [
              {
                file: "lib-2.0.jar",
                group: "dev.lib",
                artifact: "lib-neoforge",
                version: "2.0",
                modIds: ["lib"],
                blocks: ["lib:old_block", "lib:shared"],
              },
            ],
          ),
        ),
        mod("Lib", 2, jar(["lib"], ["lib:shared"])),
      ]),
      { vanilla, now: NOW },
    );
    expect(data.blocks.map((b) => [b.id, b.mod])).toEqual([
      ["addon:panel", "cf-1"],
      ["lib:shared", "cf-2"],
    ]);
    expect(data.mods[0].namespaces).toEqual(["addon"]);
    expect(warnings.filter((w) => /is in both/.test(w))).toEqual([]);
    expect(nestedJars).toEqual([
      expect.objectContaining({
        outer: "addon.jar",
        artifact: "lib-neoforge",
        kept: false,
        reason: "mod lib is a top-level jar (lib.jar)",
      }),
    ]);
  });

  it("gives a jar of only nested mods (Create Aeronautics) its blocks", async () => {
    const { data, nestedJars } = await extractModpack(
      pack([
        mod(
          "Create Aeronautics",
          7,
          jar(
            [],
            [],
            [
              {
                file: "aeronautics-1.0.jar",
                group: "dev.eriksonn",
                artifact: "aeronautics",
                version: "1.0",
                modIds: ["aeronautics"],
                blocks: ["aeronautics:propeller_bearing"],
              },
              {
                file: "simulated-1.0.jar",
                group: "dev.ryanhcode",
                artifact: "simulated",
                version: "1.0",
                modIds: ["simulated"],
                blocks: ["simulated:steering_wheel"],
              },
            ],
          ),
        ),
      ]),
      { vanilla, now: NOW },
    );
    expect(data.mods).toEqual([
      expect.objectContaining({
        status: "ok",
        namespaces: ["aeronautics", "simulated"],
        hasSwatches: true,
      }),
    ]);
    expect(data.blocks.map((b) => [b.id, b.mod, b.swatch?.file])).toEqual([
      ["aeronautics:propeller_bearing", "cf-7", "cf-7"],
      ["simulated:steering_wheel", "cf-7", "cf-7"],
    ]);
    expect(nestedJars.every((j) => j.kept)).toBe(true);
  });
});
