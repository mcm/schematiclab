// Shape Generator: a shape, a material and a Minecraft version become a
// `ParsedSchematicProjection`, which `serializeSchematic` (the Advanced
// Editor's export path) writes in any output format. Worker-safe.

import type { ParsedSchematicProjection } from "../convert";
import { isInvisibleBlockId } from "../invisible-blocks";
import { FORGE_1_12_FLATTEN } from "../schemlib/data/forge-1.12-flatten.generated";
import { translateBlockState } from "../schemlib/data/translate";
import { vanillaBlocksForVersion } from "../schemlib/data/vanilla-blocks";
import { BlockState } from "../schemlib/blocks";
import {
  getVersion,
  type MinecraftVersion,
} from "../schemlib/schematic-formats/version-mapping";
import { buildShapeGrid, voxelIndex, type ShapeOptions } from "./shapes";

/** Most blocks one generated schematic may hold. */
export const MAX_SHAPE_BLOCKS = 2_000_000;

// Materials are typed as flattened (1.13+) ids, which is also what
// `vanillaBlocksForVersion` lists for 1.12.2. 1.12.2 shapes are written with
// the Forge 1.12 block state of the material instead.
const FLATTENED_VERSION = "1.13.1";
const LEGACY_VERSION = "1.12.2";

let legacyStates: Map<string, string> | null = null;

// Legacy `id:meta` → the first Forge 1.12 block state with it.
function legacyStateFor(idMeta: string): string | undefined {
  if (legacyStates === null) {
    legacyStates = new Map();
    for (const [state, id] of Object.entries(FORGE_1_12_FLATTEN)) {
      if (!legacyStates.has(id)) legacyStates.set(id, state);
    }
  }
  return legacyStates.get(idMeta);
}

export interface ShapeSpec extends ShapeOptions {
  /** Block state, e.g. `minecraft:oak_log[axis=x]`; `minecraft:` may be left off. */
  material: string;
  /** `KNOWN_VERSIONS` key. */
  versionId: string;
  name?: string;
}

export interface ParsedMaterial {
  blockId: string;
  properties: Record<string, string>;
}

export type MaterialParseResult =
  | { ok: true; material: ParsedMaterial }
  | { ok: false; error: string };

const MATERIAL_RE = /^(?:([a-z0-9_.-]+):)?([a-z0-9_./-]+)(?:\[([^\]]*)\])?$/;
const PROPERTY_RE = /^([a-z0-9_]+)=([a-z0-9_.-]+)$/;

/** Parses a typed material. Ids are lower-cased and default to `minecraft:`. */
export function parseMaterial(input: string): MaterialParseResult {
  const text = input.trim().toLowerCase();
  if (text.length === 0) return { ok: false, error: "Choose a material." };
  const match = MATERIAL_RE.exec(text);
  if (match === null) {
    return {
      ok: false,
      error: `"${input.trim()}" isn't a block id. Use namespace:block or namespace:block[property=value].`,
    };
  }
  const blockId = `${match[1] ?? "minecraft"}:${match[2]}`;
  const properties: Record<string, string> = {};
  const props = match[3]?.trim() ?? "";
  if (props.length > 0) {
    for (const part of props.split(",")) {
      const prop = PROPERTY_RE.exec(part.trim());
      if (prop === null) {
        return {
          ok: false,
          error: `"${part.trim()}" isn't a block property. Use property=value.`,
        };
      }
      properties[prop[1]] = prop[2];
    }
  }
  if (isInvisibleBlockId(blockId)) {
    return {
      ok: false,
      error: `${blockId} would generate an empty schematic.`,
    };
  }
  return { ok: true, material: { blockId, properties } };
}

/**
 * Why `material` can't be used in `versionId`, or null. Only vanilla ids are
 * checked: a mod's blocks are written as typed.
 */
export function vanillaMaterialError(
  material: ParsedMaterial,
  versionId: string,
): string | null {
  if (!material.blockId.startsWith("minecraft:")) return null;
  if (vanillaBlocksForVersion(getVersion(versionId)).has(material.blockId)) {
    return null;
  }
  return `${material.blockId} isn't a block in Minecraft ${versionId}.`;
}

/**
 * The block state `material` is written as in `versionId`: as typed, except
 * for vanilla blocks in 1.12.2, which become their Forge 1.12 state
 * (`minecraft:granite` → `minecraft:stone[variant=granite]`).
 */
export function materialForVersion(
  material: ParsedMaterial,
  versionId: string,
): { ok: true; state: BlockState } | { ok: false; error: string } {
  const state = new BlockState({
    Name: material.blockId,
    Properties: material.properties,
  });
  if (
    versionId !== LEGACY_VERSION ||
    !material.blockId.startsWith("minecraft:")
  ) {
    return { ok: true, state };
  }
  const legacy = translateBlockState(
    state,
    getVersion(FLATTENED_VERSION),
    getVersion(LEGACY_VERSION),
  );
  const forge = legacy.Name.startsWith("minecraft:#")
    ? legacyStateFor(legacy.Name.slice("minecraft:#".length))
    : undefined;
  if (forge === undefined || forge === "minecraft:air") {
    return {
      ok: false,
      error: `${state.toString()} has no Minecraft 1.12.2 equivalent.`,
    };
  }
  return { ok: true, state: BlockState.fromString(forge) };
}

export type ShapeProjectionResult =
  | { ok: true; projection: ParsedSchematicProjection }
  | { ok: false; error: string };

/** The schematic for `spec`, or why it can't be built. */
export function buildShapeProjection(spec: ShapeSpec): ShapeProjectionResult {
  const parsed = parseMaterial(spec.material);
  if (!parsed.ok) return parsed;
  const material = parsed.material;

  let version: MinecraftVersion;
  try {
    version = getVersion(spec.versionId);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  const materialError = vanillaMaterialError(material, spec.versionId);
  if (materialError !== null) return { ok: false, error: materialError };
  const written = materialForVersion(material, spec.versionId);
  if (!written.ok) return written;
  const properties: Record<string, string> = {};
  for (const [k, v] of written.state.Properties) properties[k] = v;

  let grid;
  try {
    grid = buildShapeGrid(spec);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  if (grid.count === 0) {
    return { ok: false, error: "This shape has no blocks." };
  }
  if (grid.count > MAX_SHAPE_BLOCKS) {
    return {
      ok: false,
      error: `This shape has ${grid.count.toLocaleString("en-US")} blocks, more than the ${MAX_SHAPE_BLOCKS.toLocaleString("en-US")} allowed. Make it smaller or hollow.`,
    };
  }

  const [w, h, d] = grid.size;
  const blocks: ParsedSchematicProjection["regions"][number]["blocks"] =
    new Array(grid.count);
  let n = 0;
  for (let y = 0; y < h; y++) {
    for (let z = 0; z < d; z++) {
      for (let x = 0; x < w; x++) {
        if (grid.filled[voxelIndex(grid.size, x, y, z)]) {
          blocks[n++] = { pos: [x, y, z], paletteIndex: 0 };
        }
      }
    }
  }

  return {
    ok: true,
    projection: {
      name: spec.name?.trim() || defaultShapeName(spec),
      // A generated shape was never read from a file. The projection still
      // needs a format; export ignores it.
      inputFormat: "Litematic",
      minecraftVersion: version,
      totalBlocks: grid.count,
      palette: [
        {
          blockState: written.state.toString(),
          blockId: written.state.Name,
          properties,
          count: grid.count,
        },
      ],
      regions: [
        {
          origin: [0, 0, 0],
          size: [w, h, d],
          blocks,
          blockEntities: [],
        },
      ],
    },
  };
}

/** e.g. `stone_bricks_hollow_ellipsoid_15x10x15`. */
export function defaultShapeName(spec: ShapeSpec): string {
  const parsed = parseMaterial(spec.material);
  const material = parsed.ok
    ? parsed.material.blockId.slice(parsed.material.blockId.indexOf(":") + 1)
    : "shape";
  const shape = spec.hollow ? `hollow_${spec.shape}` : spec.shape;
  return `${material.replace(/[^a-z0-9_-]/g, "_")}_${shape}_${spec.width}x${spec.height}x${spec.depth}`;
}
